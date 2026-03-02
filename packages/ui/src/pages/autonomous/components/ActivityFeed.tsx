/**
 * ActivityFeed — Activity tab: unified timeline of heartbeat logs + messages
 */

import { useState, useEffect, useCallback } from 'react';
import { heartbeatLogsApi, agentMessagesApi } from '../../../api/endpoints/souls';
import type { HeartbeatLog, HeartbeatStats, AgentMessage } from '../../../api/endpoints/souls';
import {
  Heart,
  MessageSquare,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
} from '../../../components/icons';
import { EmptyState } from '../../../components/EmptyState';
import type { UnifiedAgent } from '../types';
import { formatTimeAgo, formatCost, formatDuration } from '../helpers';

type FilterType = 'all' | 'heartbeats' | 'messages' | 'errors';

interface ActivityItem {
  id: string;
  type: 'heartbeat' | 'message';
  timestamp: string;
  agentId?: string;
  agentName?: string;
  // Heartbeat fields
  heartbeat?: HeartbeatLog;
  // Message fields
  message?: AgentMessage;
}

interface Props {
  agents: UnifiedAgent[];
}

export function ActivityFeed({ agents }: Props) {
  const [heartbeats, setHeartbeats] = useState<HeartbeatLog[]>([]);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [stats, setStats] = useState<HeartbeatStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [hbResult, msgResult, statsResult] = await Promise.allSettled([
        heartbeatLogsApi.list(50, 0),
        agentMessagesApi.list(30, 0),
        heartbeatLogsApi.getStats(),
      ]);
      if (hbResult.status === 'fulfilled') setHeartbeats(hbResult.value.items);
      if (msgResult.status === 'fulfilled') setMessages(msgResult.value.items);
      if (statsResult.status === 'fulfilled') setStats(statsResult.value);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const getAgentName = (id: string): string => {
    const agent = agents.find((a) => a.id === id);
    return agent ? `${agent.emoji} ${agent.name}` : id.slice(0, 12);
  };

  // Build unified timeline
  const items: ActivityItem[] = [];

  for (const hb of heartbeats) {
    items.push({
      id: `hb-${hb.id}`,
      type: 'heartbeat',
      timestamp: hb.createdAt,
      agentId: hb.agentId,
      agentName: getAgentName(hb.agentId),
      heartbeat: hb,
    });
  }

  for (const msg of messages) {
    items.push({
      id: `msg-${msg.id}`,
      type: 'message',
      timestamp: msg.createdAt,
      agentId: msg.from,
      agentName: getAgentName(msg.from),
      message: msg,
    });
  }

  // Sort by timestamp desc
  items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Filter
  const filtered = items.filter((item) => {
    if (filter === 'heartbeats') return item.type === 'heartbeat';
    if (filter === 'messages') return item.type === 'message';
    if (filter === 'errors') {
      if (item.heartbeat) return item.heartbeat.tasksFailed.length > 0;
      return false;
    }
    return true;
  });

  const filterChips: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'heartbeats', label: 'Heartbeats' },
    { key: 'messages', label: 'Messages' },
    { key: 'errors', label: 'Errors Only' },
  ];

  return (
    <div className="space-y-4">
      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total Runs" value={String(stats.totalCycles)} />
          <StatCard label="Success Rate" value={`${((1 - stats.failureRate) * 100).toFixed(0)}%`} />
          <StatCard label="Avg Duration" value={formatDuration(stats.avgDurationMs)} />
          <StatCard label="Total Cost" value={formatCost(stats.totalCost)} />
        </div>
      )}

      {/* Filter chips + refresh */}
      <div className="flex items-center gap-2">
        {filterChips.map((chip) => (
          <button
            key={chip.key}
            onClick={() => setFilter(chip.key)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              filter === chip.key
                ? 'bg-primary text-white'
                : 'bg-surface dark:bg-dark-surface text-text-muted dark:text-dark-text-muted border border-border dark:border-dark-border hover:text-text-primary dark:hover:text-dark-text-primary'
            }`}
          >
            {chip.label}
          </button>
        ))}
        <button
          onClick={fetchAll}
          className="ml-auto p-1.5 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Timeline */}
      {isLoading ? (
        <p className="text-sm text-text-muted dark:text-dark-text-muted">Loading activity...</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="No activity yet"
          description="Activity from heartbeat cycles and agent messages will appear here."
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => {
            if (item.type === 'heartbeat' && item.heartbeat) {
              const hb = item.heartbeat;
              const isExpanded = expandedId === item.id;
              const hasFailed = hb.tasksFailed.length > 0;
              return (
                <div
                  key={item.id}
                  className="border border-border dark:border-dark-border rounded-lg p-3"
                >
                  <div className="flex items-center gap-2 text-xs">
                    <Heart
                      className={`w-3.5 h-3.5 ${hasFailed ? 'text-danger' : 'text-success'}`}
                    />
                    <span className="font-medium text-text-primary dark:text-dark-text-primary">
                      {item.agentName}
                    </span>
                    <span className="text-text-muted dark:text-dark-text-muted">
                      heartbeat · {hb.tasksRun.length} task{hb.tasksRun.length !== 1 ? 's' : ''}
                    </span>
                    {hasFailed && (
                      <span className="text-danger flex items-center gap-0.5">
                        <AlertCircle className="w-3 h-3" />
                        {hb.tasksFailed.length} failed
                      </span>
                    )}
                    <span className="text-text-muted dark:text-dark-text-muted ml-auto">
                      {formatDuration(hb.durationMs)} · {formatCost(hb.cost)}
                    </span>
                    <span className="text-text-muted dark:text-dark-text-muted">
                      {formatTimeAgo(hb.createdAt)}
                    </span>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : item.id)}
                      className="text-primary hover:text-primary-dark"
                    >
                      {isExpanded ? '−' : '+'}
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="mt-2 pl-5 space-y-1 text-xs text-text-muted dark:text-dark-text-muted">
                      {hb.tasksRun.map((t) => (
                        <div key={t.id} className="flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-success" />
                          <span>{t.name}</span>
                        </div>
                      ))}
                      {hb.tasksFailed.map((t) => (
                        <div key={t.id} className="flex items-center gap-1 text-danger">
                          <AlertCircle className="w-3 h-3" />
                          <span>
                            {t.id}: {t.error || 'unknown error'}
                          </span>
                        </div>
                      ))}
                      {hb.tasksSkipped.map((t) => (
                        <div
                          key={t.id}
                          className="flex items-center gap-1 text-text-muted dark:text-dark-text-muted"
                        >
                          <span className="w-3 h-3 text-center">−</span>
                          <span>
                            {t.id}: skipped{t.reason ? ` (${t.reason})` : ''}
                          </span>
                        </div>
                      ))}
                      <div className="pt-1 flex gap-3">
                        <span>
                          Tokens: {hb.tokenUsage.input}in / {hb.tokenUsage.output}out
                        </span>
                        <span>Version: {hb.soulVersion}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            }

            if (item.type === 'message' && item.message) {
              const msg = item.message;
              return (
                <div
                  key={item.id}
                  className="border border-border dark:border-dark-border rounded-lg p-3"
                >
                  <div className="flex items-center gap-2 text-xs">
                    <MessageSquare className="w-3.5 h-3.5 text-primary" />
                    <span className="font-medium text-text-primary dark:text-dark-text-primary">
                      {getAgentName(msg.from)}
                    </span>
                    <span className="text-text-muted dark:text-dark-text-muted">→</span>
                    <span className="font-medium text-text-primary dark:text-dark-text-primary">
                      {getAgentName(msg.to)}
                    </span>
                    <span className="text-text-muted dark:text-dark-text-muted">{msg.type}</span>
                    <span className="text-text-muted dark:text-dark-text-muted ml-auto">
                      {formatTimeAgo(msg.createdAt)}
                    </span>
                  </div>
                  {msg.subject && (
                    <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary mt-1 pl-5">
                      {msg.subject}
                    </p>
                  )}
                  <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5 pl-5 line-clamp-2">
                    {msg.content}
                  </p>
                </div>
              );
            }

            return null;
          })}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border dark:border-dark-border rounded-lg p-3 text-center">
      <div className="text-lg font-bold text-text-primary dark:text-dark-text-primary">{value}</div>
      <div className="text-xs text-text-muted dark:text-dark-text-muted">{label}</div>
    </div>
  );
}

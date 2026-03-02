/**
 * AgentCard — unified card for both soul-based and background agents
 */

import { useNavigate } from 'react-router-dom';
import { Eye, Pause, Play, MessageSquare, Heart } from '../../../components/icons';
import type { UnifiedAgent } from '../types';
import { AgentStatusBadge } from './AgentStatusBadge';
import { formatTimeAgo, formatCost } from '../helpers';

interface Props {
  agent: UnifiedAgent;
  onPause?: (id: string) => void;
  onResume?: (id: string) => void;
}

export function AgentCard({ agent, onPause, onResume }: Props) {
  const navigate = useNavigate();

  return (
    <div className="border border-border dark:border-dark-border rounded-xl p-4 hover:shadow-md transition-shadow bg-surface dark:bg-dark-surface">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-2xl flex-shrink-0">{agent.emoji}</span>
          <div className="min-w-0">
            <h3 className="font-semibold text-text-primary dark:text-dark-text-primary truncate">
              {agent.name}
            </h3>
            <p className="text-xs text-text-muted dark:text-dark-text-muted truncate">
              {agent.role}
              {agent.crewName && <span className="ml-1.5 text-primary"> · {agent.crewName}</span>}
            </p>
          </div>
        </div>
        <AgentStatusBadge status={agent.status} size="sm" />
      </div>

      {/* Mission + Kind badge */}
      {agent.mission && (
        <p className="mt-1.5 text-xs text-text-muted dark:text-dark-text-muted line-clamp-2">
          {agent.mission}
        </p>
      )}
      <div className="mt-2 flex items-center gap-2">
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            agent.kind === 'soul'
              ? 'bg-primary/10 text-primary'
              : 'bg-text-muted/10 text-text-muted dark:text-dark-text-muted'
          }`}
        >
          {agent.kind === 'soul' ? 'Soul Agent' : 'Background'}
        </span>
      </div>

      {/* Stats row */}
      <div className="mt-3 pt-3 border-t border-border dark:border-dark-border flex items-center gap-4 text-xs text-text-muted dark:text-dark-text-muted">
        {agent.heartbeatEnabled && (
          <span className="flex items-center gap-1">
            <Heart className="w-3 h-3 text-danger" />
            {formatTimeAgo(agent.lastActiveAt)}
          </span>
        )}
        <span>{formatCost(agent.todayCost)} today</span>
        {agent.unreadMessages > 0 && (
          <span className="flex items-center gap-1 text-primary">
            <MessageSquare className="w-3 h-3" />
            {agent.unreadMessages}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="mt-3 pt-3 border-t border-border dark:border-dark-border flex items-center gap-2">
        <button
          onClick={() => navigate(`/autonomous/agent/${agent.id}`)}
          className="flex items-center gap-1 text-xs text-primary hover:text-primary-dark transition-colors"
        >
          <Eye className="w-3.5 h-3.5" />
          View
        </button>
        {(agent.status === 'running' || agent.status === 'waiting') && onPause && (
          <button
            onClick={() => onPause(agent.id)}
            className="flex items-center gap-1 text-xs text-warning hover:opacity-80 transition-opacity"
          >
            <Pause className="w-3.5 h-3.5" />
            Pause
          </button>
        )}
        {(agent.status === 'paused' || agent.status === 'idle' || agent.status === 'stopped') &&
          onResume && (
            <button
              onClick={() => onResume(agent.id)}
              className="flex items-center gap-1 text-xs text-success hover:opacity-80 transition-opacity"
            >
              <Play className="w-3.5 h-3.5" />
              Resume
            </button>
          )}
      </div>
    </div>
  );
}

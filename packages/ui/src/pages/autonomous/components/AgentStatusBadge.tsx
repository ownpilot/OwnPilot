/**
 * AgentStatusBadge — pulsing status dot with label
 */

import type { AgentStatus } from '../types';
import { STATUS_COLORS, STATUS_LABELS, STATUS_TEXT_COLORS } from '../helpers';

interface Props {
  status: AgentStatus;
  showLabel?: boolean;
  size?: 'sm' | 'md';
}

export function AgentStatusBadge({ status, showLabel = true, size = 'md' }: Props) {
  const dotSize = size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5';
  const isAnimated = status === 'running' || status === 'starting';

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative flex">
        {isAnimated && (
          <span
            className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping ${STATUS_COLORS[status]}`}
          />
        )}
        <span className={`relative inline-flex rounded-full ${dotSize} ${STATUS_COLORS[status]}`} />
      </span>
      {showLabel && (
        <span className={`text-xs font-medium ${STATUS_TEXT_COLORS[status]}`}>
          {STATUS_LABELS[status]}
        </span>
      )}
    </span>
  );
}

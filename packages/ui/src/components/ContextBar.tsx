import type { SessionInfo } from '../types';
import { Plus } from './icons';

interface ContextBarProps {
  sessionInfo: SessionInfo | null;
  /** Context window size from model config, used as default before first API response */
  defaultMaxTokens?: number;
  onNewSession: () => void;
  onShowDetail?: () => void;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function getFillColor(percent: number): string {
  if (percent >= 80) return 'bg-red-500';
  if (percent >= 50) return 'bg-yellow-500';
  return 'bg-emerald-500';
}

function getFillTextColor(percent: number): string {
  if (percent >= 80) return 'text-red-600 dark:text-red-400';
  if (percent >= 50) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-emerald-600 dark:text-emerald-400';
}

export function ContextBar({ sessionInfo, defaultMaxTokens, onNewSession, onShowDetail }: ContextBarProps) {
  // Show immediately with defaults — don't wait for first message
  const messageCount = sessionInfo?.messageCount ?? 0;
  const estimatedTokens = sessionInfo?.estimatedTokens ?? 0;
  const maxContextTokens = sessionInfo?.maxContextTokens ?? defaultMaxTokens ?? 128_000;
  const contextFillPercent = sessionInfo?.contextFillPercent ?? 0;
  const cachedTokens = sessionInfo?.cachedTokens;

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 bg-bg-secondary dark:bg-dark-bg-secondary border-b border-border dark:border-dark-border text-xs">
      {/* Message count */}
      <span className="text-text-secondary dark:text-dark-text-secondary whitespace-nowrap">
        {messageCount} msgs
      </span>

      {/* Token progress bar — clickable for detail */}
      <button
        onClick={onShowDetail}
        className="flex items-center gap-2 flex-1 min-w-0 group"
        title="Click for context breakdown"
      >
        <div className="flex-1 h-1.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-full overflow-hidden group-hover:h-2 transition-all">
          <div
            className={`h-full rounded-full transition-all duration-300 ${getFillColor(contextFillPercent)}`}
            style={{ width: `${Math.min(100, contextFillPercent)}%` }}
          />
        </div>
        <span className="text-text-secondary dark:text-dark-text-secondary whitespace-nowrap group-hover:text-text-primary dark:group-hover:text-dark-text-primary transition-colors">
          {formatTokens(estimatedTokens)} / {formatTokens(maxContextTokens)}
        </span>
      </button>

      {/* Fill % + cached indicator */}
      <span className={`font-medium whitespace-nowrap ${getFillTextColor(contextFillPercent)}`}>
        {contextFillPercent}%
      </span>
      {cachedTokens != null && cachedTokens > 0 && (
        <span className="text-text-tertiary dark:text-dark-text-tertiary whitespace-nowrap" title={`${formatTokens(cachedTokens)} tokens served from prompt cache`}>
          {formatTokens(cachedTokens)} cached
        </span>
      )}

      {/* New Session button */}
      <button
        onClick={onNewSession}
        className="flex items-center gap-1 px-2 py-1 text-text-secondary dark:text-dark-text-secondary hover:text-primary dark:hover:text-primary rounded transition-colors"
        title="Start new session"
      >
        <Plus className="w-3 h-3" />
        <span className="hidden sm:inline">New</span>
      </button>
    </div>
  );
}

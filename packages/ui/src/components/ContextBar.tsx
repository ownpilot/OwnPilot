import type { SessionInfo } from '../types';
import { formatNumber } from '../utils/formatters';
import { Plus } from './icons';

interface ContextBarProps {
  sessionInfo: SessionInfo | null;
  /** Context window size from model config, used as default before first API response */
  defaultMaxTokens?: number;
  onNewSession: () => void;
  onShowDetail?: () => void;
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

function getContextStatus(percent: number): string {
  if (percent >= 85) return 'Near limit';
  if (percent >= 65) return 'Getting full';
  return 'Healthy';
}

export function ContextBar({
  sessionInfo,
  defaultMaxTokens,
  onNewSession,
  onShowDetail,
}: ContextBarProps) {
  // Show immediately with defaults — don't wait for first message
  const messageCount = sessionInfo?.messageCount ?? 0;
  const estimatedTokens = sessionInfo?.estimatedTokens ?? 0;
  const maxContextTokens = sessionInfo?.maxContextTokens ?? defaultMaxTokens ?? 128_000;
  const derivedFillPercent =
    maxContextTokens > 0 ? Math.round((estimatedTokens / maxContextTokens) * 100) : 0;
  const reportedFillPercent = sessionInfo?.contextFillPercent;
  const contextFillPercent = Math.max(
    0,
    Math.min(
      100,
      reportedFillPercent != null && (reportedFillPercent > 0 || estimatedTokens === 0)
        ? reportedFillPercent
        : derivedFillPercent
    )
  );
  const remainingTokens = Math.max(0, maxContextTokens - estimatedTokens);
  const cachedTokens = sessionInfo?.cachedTokens;
  const status = getContextStatus(contextFillPercent);
  const detailTitle = `${status}: ${formatNumber(estimatedTokens)} used, ${formatNumber(
    remainingTokens
  )} remaining of ${formatNumber(maxContextTokens)} tokens`;

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
        title={detailTitle}
        aria-label={`Open context breakdown. ${detailTitle}`}
      >
        <div
          className="flex-1 h-1.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-full overflow-hidden group-hover:h-2 transition-all"
          role="progressbar"
          aria-label="Context window usage"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={contextFillPercent}
        >
          <div
            className={`h-full rounded-full transition-all duration-300 ${getFillColor(contextFillPercent)}`}
            style={{ width: `${contextFillPercent}%` }}
          />
        </div>
        <span className="text-text-secondary dark:text-dark-text-secondary whitespace-nowrap group-hover:text-text-primary dark:group-hover:text-dark-text-primary transition-colors">
          {formatNumber(estimatedTokens)} / {formatNumber(maxContextTokens)}
        </span>
      </button>

      {/* Fill % + cached indicator */}
      <span
        className={`hidden md:inline font-medium whitespace-nowrap ${getFillTextColor(contextFillPercent)}`}
      >
        {status}
      </span>
      <span className={`font-medium whitespace-nowrap ${getFillTextColor(contextFillPercent)}`}>
        {contextFillPercent}%
      </span>
      <span className="hidden lg:inline text-text-tertiary dark:text-dark-text-tertiary whitespace-nowrap">
        {formatNumber(remainingTokens)} left
      </span>
      {cachedTokens != null && cachedTokens > 0 && (
        <span
          className="text-text-tertiary dark:text-dark-text-tertiary whitespace-nowrap"
          title={`${formatNumber(cachedTokens)} tokens served from prompt cache`}
        >
          {formatNumber(cachedTokens)} cached
        </span>
      )}

      {/* New Session button */}
      <button
        onClick={onNewSession}
        className="flex items-center gap-1 px-2 py-1 text-text-secondary dark:text-dark-text-secondary hover:text-primary dark:hover:text-primary rounded transition-colors"
        title="Start new session"
        aria-label="Start new chat session"
      >
        <Plus className="w-3 h-3" />
        <span className="hidden sm:inline">New</span>
      </button>
    </div>
  );
}

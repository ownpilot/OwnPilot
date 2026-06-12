import { useState, useEffect } from 'react';
import { X, Trash2, RefreshCw } from './icons';
import { chatApi } from '../api';
import { STORAGE_KEYS } from '../constants/storage-keys';
import type { ContextBreakdown, SessionInfo } from '../types';
import { formatNumber } from '../utils/formatters';

// =============================================================================
// Segmented bar colors
// =============================================================================

const COLORS = {
  system: 'bg-blue-500',
  messages: 'bg-amber-500',
  free: 'bg-bg-tertiary dark:bg-dark-bg-tertiary',
};

const LABEL_COLORS = {
  system: 'bg-blue-500',
  messages: 'bg-amber-500',
  free: 'bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border',
};

// =============================================================================
// Component
// =============================================================================

interface ContextDetailModalProps {
  sessionInfo: SessionInfo;
  provider: string;
  model: string;
  onClose: () => void;
  onCompact: () => Promise<void>;
  onClear: () => void;
  /** The most recent compaction summary (if any) so the user can verify it. */
  lastCompactionSummary?: string | null;
  /** Clear the stored summary (e.g. when the user closes the preview). */
  onDismissSummary?: () => void;
}

export function ContextDetailModal({
  sessionInfo,
  provider,
  model,
  onClose,
  onCompact,
  onClear,
  lastCompactionSummary,
  onDismissSummary,
}: ContextDetailModalProps) {
  const [breakdown, setBreakdown] = useState<ContextBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [compacting, setCompacting] = useState(false);
  const [compactError, setCompactError] = useState<string | null>(null);
  // Read once on mount — survives across modal open/close within a session.
  const [bannerDisabled, setBannerDisabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.AUTO_COMPACT_DISABLED) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    chatApi
      .getContextDetail(provider, model)
      .then((r) => setBreakdown(r.breakdown))
      .catch(() => setBreakdown(null))
      .finally(() => setLoading(false));
  }, [provider, model]);

  const handleCompact = async () => {
    setCompacting(true);
    setCompactError(null);
    try {
      await onCompact();
      // Don't auto-close — the parent passes the summary down via
      // `lastCompactionSummary` so the user can verify what was preserved.
      // They close the modal manually when satisfied. If for some reason no
      // summary is available (e.g. legacy server), close as before.
    } catch (err) {
      // Surface a brief reason instead of silently swallowing — server can
      // refuse with "too few messages", "no api key", or a summarization
      // failure. Keep the modal open so the user can decide what to do.
      const message =
        err instanceof Error && err.message ? err.message : 'Could not compact this conversation.';
      setCompactError(message);
    } finally {
      setCompacting(false);
    }
  };

  const handleReEnableBanner = () => {
    try {
      localStorage.removeItem(STORAGE_KEYS.AUTO_COMPACT_DISABLED);
    } catch {
      /* localStorage might be blocked — toggle still applies in memory */
    }
    setBannerDisabled(false);
  };

  const maxTokens = breakdown?.maxContextTokens ?? sessionInfo.maxContextTokens;
  const systemTokens = breakdown?.systemPromptTokens ?? 0;
  const messageTokens = breakdown?.messageHistoryTokens ?? sessionInfo.estimatedTokens;
  const totalUsed = systemTokens + messageTokens;
  const systemPct = maxTokens > 0 ? Math.min(100, (systemTokens / maxTokens) * 100) : 0;
  const rawMessagePct = maxTokens > 0 ? (messageTokens / maxTokens) * 100 : 0;
  const messagePct = Math.min(Math.max(0, 100 - systemPct), rawMessagePct);
  const fillPct = maxTokens > 0 ? Math.min(100, Math.round((totalUsed / maxTokens) * 100)) : 0;
  const remainingTokens = Math.max(0, maxTokens - totalUsed);
  const freePct = Math.max(0, 100 - systemPct - messagePct);
  // Allow compact at higher fill % even with few messages — a single huge
  // tool result can blow the window with only 4 messages.
  const canCompact =
    sessionInfo.messageCount >= 4 && (sessionInfo.messageCount >= 8 || fillPct >= 50);
  const statusLabel = fillPct >= 90 ? 'Near limit' : fillPct >= 75 ? 'Getting full' : 'Healthy';
  const statusColor =
    fillPct >= 90
      ? 'text-red-700 dark:text-red-300'
      : fillPct >= 75
        ? 'text-yellow-700 dark:text-yellow-300'
        : 'text-emerald-700 dark:text-emerald-300';
  const recommendation =
    fillPct >= 90
      ? 'Near limit. Compact this session or start a fresh chat before the model starts losing older context.'
      : fillPct >= 75
        ? 'Getting full. You can continue, but compacting soon will keep older details easier to recover.'
        : 'Healthy. There is still enough room for this conversation to keep growing.';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-bg-primary dark:bg-dark-bg-primary rounded-xl shadow-xl border border-border dark:border-dark-border w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border dark:border-dark-border">
          <h2 className="text-base font-semibold text-text-primary dark:text-dark-text-primary">
            Context Usage
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-4">
          {/* Model info */}
          <div className="text-xs text-text-muted dark:text-dark-text-muted">
            {breakdown?.providerName ?? provider} / {breakdown?.modelName ?? model}
            <span className="ml-2 text-text-secondary dark:text-dark-text-secondary">
              (max {formatNumber(maxTokens)} tokens)
            </span>
          </div>

          {/* Segmented progress bar */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                {fillPct}% used
              </span>
              <span className="text-xs text-text-muted dark:text-dark-text-muted">
                {formatNumber(totalUsed)} / {formatNumber(maxTokens)}
              </span>
              <span className="ml-auto text-xs text-text-muted dark:text-dark-text-muted">
                {formatNumber(remainingTokens)} left
              </span>
            </div>
            <div
              className="h-3 rounded-full overflow-hidden flex bg-bg-tertiary dark:bg-dark-bg-tertiary"
              role="progressbar"
              aria-label="Context window usage"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={fillPct}
            >
              {systemPct > 0 && (
                <div
                  className={`${COLORS.system} transition-all duration-300`}
                  style={{ width: `${systemPct}%` }}
                  title={`System: ${formatNumber(systemTokens)}`}
                />
              )}
              {messagePct > 0 && (
                <div
                  className={`${COLORS.messages} transition-all duration-300`}
                  style={{ width: `${messagePct}%` }}
                  title={`Messages: ${formatNumber(messageTokens)}`}
                />
              )}
              {freePct > 0 && (
                <div
                  className={`${COLORS.free} transition-all duration-300`}
                  style={{ width: `${freePct}%` }}
                  title={`Free: ${formatNumber(remainingTokens)}`}
                />
              )}
            </div>
            <div className="flex items-center gap-4 mt-1.5 text-[10px] text-text-muted dark:text-dark-text-muted">
              <span className="flex items-center gap-1">
                <span className={`inline-block w-2 h-2 rounded-sm ${LABEL_COLORS.system}`} />
                System ({formatNumber(systemTokens)})
              </span>
              <span className="flex items-center gap-1">
                <span className={`inline-block w-2 h-2 rounded-sm ${LABEL_COLORS.messages}`} />
                Messages ({formatNumber(messageTokens)})
              </span>
              <span className="flex items-center gap-1">
                <span className={`inline-block w-2 h-2 rounded-sm ${LABEL_COLORS.free}`} />
                Free ({formatNumber(remainingTokens)})
              </span>
              <span className="ml-auto">{sessionInfo.messageCount} msgs</span>
            </div>
          </div>

          <div className="rounded-lg border border-border dark:border-dark-border bg-bg-secondary/70 dark:bg-dark-bg-secondary/70 px-3 py-2">
            <div className={`text-xs font-medium ${statusColor}`}>{statusLabel}</div>
            <p className="mt-1 text-xs leading-5 text-text-secondary dark:text-dark-text-secondary">
              {recommendation}
            </p>
            {sessionInfo.cachedTokens != null && sessionInfo.cachedTokens > 0 && (
              <p className="mt-1 text-[11px] text-text-muted dark:text-dark-text-muted">
                {formatNumber(sessionInfo.cachedTokens)} tokens served from prompt cache
                {sessionInfo.estimatedTokens > 0 && (
                  <>
                    {' '}
                    (
                    {Math.min(
                      100,
                      Math.round((sessionInfo.cachedTokens / sessionInfo.estimatedTokens) * 100)
                    )}
                    % of input · billed at ~10% of normal)
                  </>
                )}
                .
              </p>
            )}
          </div>

          {/* Section breakdown */}
          {loading ? (
            <div className="text-xs text-text-muted dark:text-dark-text-muted py-2">
              Loading breakdown...
            </div>
          ) : breakdown && breakdown.sections.length > 0 ? (
            <div>
              <h3 className="text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                System Prompt Sections
              </h3>
              <div className="space-y-0.5 max-h-48 overflow-y-auto">
                {breakdown.sections.map((section, i) => {
                  const sectionPct =
                    systemTokens > 0 ? Math.round((section.tokens / systemTokens) * 100) : 0;
                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between px-2 py-1 rounded text-xs hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary"
                    >
                      <span className="text-text-primary dark:text-dark-text-primary truncate flex-1">
                        {section.name}
                      </span>
                      <span className="text-text-muted dark:text-dark-text-muted ml-2 tabular-nums whitespace-nowrap">
                        ~{formatNumber(section.tokens)} ({sectionPct}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Auto-compact banner re-enable affordance */}
          {bannerDisabled && (
            <div className="flex items-center gap-2 rounded-lg border border-border dark:border-dark-border bg-bg-secondary/70 dark:bg-dark-bg-secondary/70 px-3 py-2 text-xs">
              <span className="text-text-secondary dark:text-dark-text-secondary flex-1">
                Auto-compact banner is off. You can still compact from here.
              </span>
              <button
                onClick={handleReEnableBanner}
                className="px-2 py-1 rounded-md text-primary hover:bg-primary/10 transition-colors"
              >
                Re-enable
              </button>
            </div>
          )}

          {/* Most recent compaction summary — lets the user verify nothing
              important was lost. Cleared when they dismiss. */}
          {lastCompactionSummary && (
            <div className="rounded-lg border border-emerald-300 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2 text-xs">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="font-medium text-emerald-800 dark:text-emerald-200">
                  Last compaction summary
                </span>
                {onDismissSummary && (
                  <button
                    onClick={onDismissSummary}
                    className="ml-auto text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 dark:hover:text-emerald-100"
                    aria-label="Dismiss compaction summary"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <pre className="whitespace-pre-wrap font-sans text-[11px] leading-5 max-h-48 overflow-y-auto text-text-secondary dark:text-dark-text-secondary">
                {lastCompactionSummary}
              </pre>
            </div>
          )}

          {/* Compact error feedback */}
          {compactError && (
            <div
              role="alert"
              className="rounded-lg border border-red-300 dark:border-red-800/40 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-700 dark:text-red-300"
            >
              {compactError}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-border dark:border-dark-border bg-bg-secondary/50 dark:bg-dark-bg-secondary/50">
          <button
            onClick={handleCompact}
            disabled={compacting || canCompact === false}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-40 transition-colors"
            title={
              canCompact === false
                ? 'Need a few more messages or higher fill % to compact'
                : 'Summarize old messages and keep the recent ones'
            }
          >
            {compacting ? (
              <RefreshCw className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
            Compact
          </button>
          <button
            onClick={onClear}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg text-error hover:bg-error/10 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            Clear Session
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-lg text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

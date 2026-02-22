import { useState, useEffect } from 'react';
import { X, Trash2, RefreshCw } from './icons';
import { chatApi } from '../api';
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
}

export function ContextDetailModal({
  sessionInfo,
  provider,
  model,
  onClose,
  onCompact,
  onClear,
}: ContextDetailModalProps) {
  const [breakdown, setBreakdown] = useState<ContextBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [compacting, setCompacting] = useState(false);

  useEffect(() => {
    chatApi.getContextDetail(provider, model)
      .then(r => setBreakdown(r.breakdown))
      .catch(() => setBreakdown(null))
      .finally(() => setLoading(false));
  }, [provider, model]);

  const handleCompact = async () => {
    setCompacting(true);
    try {
      await onCompact();
      onClose();
    } catch {
      // Error handled by parent
    } finally {
      setCompacting(false);
    }
  };

  const maxTokens = breakdown?.maxContextTokens ?? sessionInfo.maxContextTokens;
  const systemTokens = breakdown?.systemPromptTokens ?? 0;
  const messageTokens = breakdown?.messageHistoryTokens ?? sessionInfo.estimatedTokens;
  const totalUsed = systemTokens + messageTokens;
  const systemPct = maxTokens > 0 ? (systemTokens / maxTokens) * 100 : 0;
  const messagePct = maxTokens > 0 ? (messageTokens / maxTokens) * 100 : 0;
  const fillPct = Math.min(100, Math.round((totalUsed / maxTokens) * 100));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-bg-primary dark:bg-dark-bg-primary rounded-xl shadow-xl border border-border dark:border-dark-border w-full max-w-md mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border dark:border-dark-border">
          <h2 className="text-base font-semibold text-text-primary dark:text-dark-text-primary">
            Context Usage
          </h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted">
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
              <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">{fillPct}% used</span>
              <span className="text-xs text-text-muted dark:text-dark-text-muted">
                {formatNumber(totalUsed)} / {formatNumber(maxTokens)}
              </span>
            </div>
            <div className="h-3 rounded-full overflow-hidden flex bg-bg-tertiary dark:bg-dark-bg-tertiary">
              {systemPct > 0 && (
                <div className={`${COLORS.system} transition-all duration-300`} style={{ width: `${systemPct}%` }} title={`System: ${formatNumber(systemTokens)}`} />
              )}
              {messagePct > 0 && (
                <div className={`${COLORS.messages} transition-all duration-300`} style={{ width: `${messagePct}%` }} title={`Messages: ${formatNumber(messageTokens)}`} />
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
              <span className="ml-auto">{sessionInfo.messageCount} msgs</span>
            </div>
          </div>

          {/* Section breakdown */}
          {loading ? (
            <div className="text-xs text-text-muted dark:text-dark-text-muted py-2">Loading breakdown...</div>
          ) : breakdown && breakdown.sections.length > 0 ? (
            <div>
              <h3 className="text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-2">System Prompt Sections</h3>
              <div className="space-y-0.5 max-h-48 overflow-y-auto">
                {breakdown.sections.map((section, i) => {
                  const sectionPct = systemTokens > 0 ? Math.round((section.tokens / systemTokens) * 100) : 0;
                  return (
                    <div key={i} className="flex items-center justify-between px-2 py-1 rounded text-xs hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary">
                      <span className="text-text-primary dark:text-dark-text-primary truncate flex-1">{section.name}</span>
                      <span className="text-text-muted dark:text-dark-text-muted ml-2 tabular-nums whitespace-nowrap">
                        ~{formatNumber(section.tokens)} ({sectionPct}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-border dark:border-dark-border bg-bg-secondary/50 dark:bg-dark-bg-secondary/50">
          <button
            onClick={handleCompact}
            disabled={compacting || sessionInfo.messageCount < 10}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-40 transition-colors"
            title={sessionInfo.messageCount < 10 ? 'Need at least 10 messages to compact' : 'Summarize old messages'}
          >
            {compacting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
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

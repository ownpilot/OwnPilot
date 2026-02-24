/**
 * DebugDrawer — Real-time LLM Inspector Panel
 *
 * Bottom drawer that shows all LLM requests/responses as they happen.
 * Subscribes to `debug:entry` WebSocket events for real-time updates.
 * Toggle with Ctrl+Shift+D or the drawer handle.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useGateway } from '../hooks/useWebSocket';
import { STORAGE_KEYS } from '../constants/storage-keys';

interface DebugEntry {
  timestamp: string;
  type:
    | 'request'
    | 'response'
    | 'tool_call'
    | 'tool_result'
    | 'error'
    | 'retry'
    | 'sandbox_execution';
  provider?: string;
  model?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  duration?: number;
}

type FilterType = 'all' | 'request' | 'response' | 'tool_call' | 'tool_result' | 'error';

const MAX_ENTRIES = 200;

const TYPE_STYLES: Record<string, { bg: string; label: string }> = {
  request: { bg: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', label: 'REQ' },
  response: {
    bg: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    label: 'RES',
  },
  tool_call: {
    bg: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    label: 'TOOL',
  },
  tool_result: {
    bg: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
    label: 'RESULT',
  },
  error: { bg: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', label: 'ERR' },
  retry: {
    bg: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    label: 'RETRY',
  },
  sandbox_execution: {
    bg: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    label: 'SANDBOX',
  },
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour12: false });
}

function formatDuration(ms: number | undefined): string {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function summarizeEntry(entry: DebugEntry): string {
  const d = entry.data;
  if (!d) return '';
  switch (entry.type) {
    case 'request':
      return `${d.messages?.length ?? 0} msgs, ${d.tools?.length ?? 0} tools${d.stream ? ', stream' : ''}`;
    case 'response':
      if (d.status === 'error') return d.error ?? 'error';
      return [
        d.contentPreview
          ? `"${d.contentPreview.slice(0, 60)}${d.contentPreview.length > 60 ? '...' : ''}"`
          : '',
        d.toolCalls?.length ? `${d.toolCalls.length} tool calls` : '',
        d.usage ? `${d.usage.totalTokens}tok` : '',
      ]
        .filter(Boolean)
        .join(' | ');
    case 'tool_call':
      return `${d.name ?? '?'}${d.approved === false ? ' [rejected]' : ''}`;
    case 'tool_result':
      return `${d.name ?? '?'} ${d.success ? 'ok' : 'fail'} (${formatDuration(d.durationMs)})`;
    case 'error':
      return d.error ?? 'unknown error';
    case 'retry':
      return `attempt ${d.attempt}/${d.maxRetries}, wait ${formatDuration(d.delayMs)}`;
    case 'sandbox_execution':
      return `${d.tool ?? '?'} (${d.language}) ${d.success ? 'ok' : 'fail'}`;
    default:
      return '';
  }
}

export function DebugDrawer() {
  const { subscribe } = useGateway();
  const [isOpen, setIsOpen] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.DEBUG_DRAWER) === 'true';
    } catch {
      return false;
    }
  });
  const [entries, setEntries] = useState<DebugEntry[]>([]);
  const [filter, setFilter] = useState<FilterType>('all');
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  // Persist open/close state
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.DEBUG_DRAWER, String(isOpen));
    } catch {
      /* ignore */
    }
  }, [isOpen]);

  // Keyboard shortcut: Ctrl+Shift+D
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Subscribe to debug:entry WebSocket events
  useEffect(() => {
    const unsubscribe = subscribe<DebugEntry>('debug:entry', (entry) => {
      setEntries((prev) => {
        const next = [...prev, entry];
        return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
      });
    });
    return unsubscribe;
  }, [subscribe]);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScroll && isOpen && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [entries, autoScroll, isOpen]);

  // Detect manual scroll to pause auto-scroll
  const handleScroll = useCallback(() => {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isAtBottom);
  }, []);

  const filtered = useMemo(
    () => (filter === 'all' ? entries : entries.filter((e) => e.type === filter)),
    [entries, filter]
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of entries) c[e.type] = (c[e.type] ?? 0) + 1;
    return c;
  }, [entries]);

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const clearEntries = useCallback(() => {
    setEntries([]);
    setExpandedIdx(null);
  }, []);

  return (
    <div
      className={`shrink-0 flex flex-col transition-all duration-200 ease-out ${
        isOpen ? 'h-[40vh]' : 'h-9'
      }`}
    >
      {/* Handle bar */}
      <div
        className="h-9 shrink-0 flex items-center gap-2 px-3 bg-bg-secondary dark:bg-dark-bg-secondary border-t border-border dark:border-dark-border cursor-pointer select-none"
        onClick={toggle}
      >
        <button
          className="text-xs font-mono font-semibold text-text-secondary dark:text-dark-text-secondary"
          title="Toggle Debug Drawer (Ctrl+Shift+D)"
        >
          {isOpen ? '\u25BC' : '\u25B2'} Debug
        </button>

        {/* Entry count badges */}
        <div className="flex gap-1 text-[10px] leading-none">
          {entries.length > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted">
              {entries.length}
            </span>
          )}
          {(counts.error ?? 0) > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
              {counts.error} err
            </span>
          )}
        </div>

        <div className="flex-1" />

        {/* Controls (only when open) */}
        {isOpen && (
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {/* Filter */}
            <select
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value as FilterType);
                setExpandedIdx(null);
              }}
              className="h-6 px-1 text-[11px] bg-bg-tertiary dark:bg-dark-bg-tertiary border-0 rounded focus:ring-1 focus:ring-primary text-text-secondary dark:text-dark-text-secondary"
            >
              <option value="all">All</option>
              <option value="request">Requests</option>
              <option value="response">Responses</option>
              <option value="tool_call">Tool Calls</option>
              <option value="tool_result">Tool Results</option>
              <option value="error">Errors</option>
            </select>

            {/* Auto-scroll indicator */}
            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                autoScroll
                  ? 'bg-primary/20 text-primary'
                  : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted'
              }`}
              title={autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
            >
              {autoScroll ? 'LIVE' : 'PAUSED'}
            </button>

            {/* Clear */}
            <button
              onClick={clearEntries}
              className="text-[11px] px-1.5 py-0.5 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted hover:bg-error/10 hover:text-error transition-colors"
              title="Clear all entries"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Entry list */}
      {isOpen && (
        <div
          ref={listRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto bg-bg-primary dark:bg-dark-bg-primary font-mono text-xs"
        >
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center h-full text-text-muted dark:text-dark-text-muted">
              No debug entries yet. Send a chat message to see LLM traffic.
            </div>
          ) : (
            filtered.map((entry, idx) => {
              const style = TYPE_STYLES[entry.type] ?? TYPE_STYLES.error!;
              const isExpanded = expandedIdx === idx;
              const badgeBg = style?.bg ?? '';
              const badgeLabel = style?.label ?? entry.type;
              return (
                <div key={`${entry.timestamp}-${idx}`}>
                  {/* Summary row */}
                  <button
                    onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                    className={`w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors border-b border-border/50 dark:border-dark-border/50 ${
                      isExpanded ? 'bg-bg-tertiary dark:bg-dark-bg-tertiary' : ''
                    }`}
                  >
                    <span className="text-text-muted dark:text-dark-text-muted shrink-0 w-[60px]">
                      {formatTime(entry.timestamp)}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${badgeBg}`}
                    >
                      {badgeLabel}
                    </span>
                    {entry.provider && (
                      <span className="text-text-muted dark:text-dark-text-muted shrink-0">
                        {entry.provider}
                      </span>
                    )}
                    {entry.model && (
                      <span className="text-text-muted/60 dark:text-dark-text-muted/60 shrink-0 max-w-[100px] truncate">
                        {entry.model}
                      </span>
                    )}
                    {entry.duration != null && (
                      <span className="text-text-muted dark:text-dark-text-muted shrink-0">
                        {formatDuration(entry.duration)}
                      </span>
                    )}
                    <span className="text-text-secondary dark:text-dark-text-secondary truncate flex-1">
                      {summarizeEntry(entry)}
                    </span>
                    <span className="text-text-muted dark:text-dark-text-muted shrink-0">
                      {isExpanded ? '\u25B4' : '\u25BE'}
                    </span>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-3 py-2 bg-bg-secondary dark:bg-dark-bg-secondary border-b border-border dark:border-dark-border">
                      <pre className="whitespace-pre-wrap break-all text-[11px] text-text-secondary dark:text-dark-text-secondary max-h-[200px] overflow-auto">
                        {JSON.stringify(entry.data, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

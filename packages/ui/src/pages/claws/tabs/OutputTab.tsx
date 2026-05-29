import { useState, useEffect, useRef, useMemo } from 'react';
import { ignoreError } from '../../../utils/ignore-error';
import { timeAgo } from '../utils';

export interface ClawOutputEvent {
  clawId: string;
  message?: string;
  type?: string;
  title?: string;
  summary?: string;
  urgency?: string;
  timestamp: string;
}

const URGENCY_COLORS: Record<string, string> = {
  urgent: 'text-red-400',
  high: 'text-amber-400',
  normal: 'text-green-400',
  info: 'text-blue-400',
  report: 'text-purple-400',
};

const URGENCY_BG: Record<string, string> = {
  urgent: 'bg-red-500/10 text-red-600',
  high: 'bg-amber-500/10 text-amber-600',
  normal: 'bg-green-500/10 text-green-600',
  info: 'bg-blue-500/10 text-blue-600',
  report: 'bg-purple-500/10 text-purple-600',
};

// Static class maps — Tailwind cannot resolve `border-${u}/30` at build time,
// so previous pills rendered unstyled. These maps keep every class string
// statically scannable.
const URGENCY_PILL_IDLE: Record<string, string> = {
  urgent: 'text-red-400 border-red-500/30 bg-red-500/5',
  high: 'text-amber-400 border-amber-500/30 bg-amber-500/5',
  normal: 'text-green-400 border-green-500/30 bg-green-500/5',
  info: 'text-blue-400 border-blue-500/30 bg-blue-500/5',
  report: 'text-purple-400 border-purple-500/30 bg-purple-500/5',
};
const TYPE_PILL_IDLE: Record<string, string> = {
  report: 'text-purple-400 border-purple-500/30 bg-purple-500/5',
  progress: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/5',
  artifact: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/5',
  error: 'text-red-400 border-red-500/30 bg-red-500/5',
  warning: 'text-amber-400 border-amber-500/30 bg-amber-500/5',
  message: 'text-green-400 border-green-500/30 bg-green-500/5',
  output: 'text-gray-300 border-gray-700 bg-gray-500/5',
};
const TYPE_PILL_ACTIVE: Record<string, string> = {
  report: 'bg-purple-500/10 text-purple-600 border-transparent',
  progress: 'bg-cyan-500/10 text-cyan-600 border-transparent',
  artifact: 'bg-yellow-500/10 text-yellow-600 border-transparent',
  error: 'bg-red-500/10 text-red-600 border-transparent',
  warning: 'bg-amber-500/10 text-amber-600 border-transparent',
  message: 'bg-green-500/10 text-green-600 border-transparent',
  output: 'bg-gray-500/15 text-gray-300 border-transparent',
};

// Build a fixed-bucket sparkline from event timestamps. The strip is purely
// visual — it animates the terminal so an operator can see "is this thing
// actually doing work right now or has it gone quiet for a minute".
const SPARK_BUCKETS = 32;
function buildSparkline(events: ClawOutputEvent[]): {
  buckets: number[];
  max: number;
  rangeMs: number;
} {
  if (events.length === 0) return { buckets: [], max: 0, rangeMs: 0 };
  const first = new Date(events[0]!.timestamp).getTime();
  const last = new Date(events[events.length - 1]!.timestamp).getTime();
  const rangeMs = Math.max(1, last - first);
  const buckets = new Array<number>(SPARK_BUCKETS).fill(0);
  for (const e of events) {
    const t = new Date(e.timestamp).getTime();
    const idx = Math.min(SPARK_BUCKETS - 1, Math.floor(((t - first) / rangeMs) * SPARK_BUCKETS));
    buckets[idx] = (buckets[idx] ?? 0) + 1;
  }
  let max = 0;
  for (const b of buckets) if (b > max) max = b;
  return { buckets, max, rangeMs };
}

function formatRange(rangeMs: number): string {
  if (rangeMs < 60_000) return `${Math.round(rangeMs / 1000)}s span`;
  if (rangeMs < 3_600_000) return `${Math.round(rangeMs / 60_000)}m span`;
  return `${(rangeMs / 3_600_000).toFixed(1)}h span`;
}

const TYPE_COLORS: Record<string, string> = {
  report: 'text-purple-400',
  progress: 'text-cyan-400',
  artifact: 'text-yellow-400',
  error: 'text-red-400',
  warning: 'text-amber-400',
  message: 'text-green-400',
  output: 'text-gray-300',
};

const TYPE_PREFIX: Record<string, string> = {
  report: '📋',
  progress: '⚡',
  artifact: '📦',
  error: '✗',
  warning: '⚠',
  message: '›',
  output: '›',
};

export function OutputTab({ outputFeed }: { outputFeed: ClawOutputEvent[] }) {
  const [isPaused, setIsPaused] = useState(false);
  const [isScrollLocked, setIsScrollLocked] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const displayFeed = outputFeed;

  const filteredFeed = useMemo(() => {
    return displayFeed.filter((evt) => {
      if (urgencyFilter && evt.urgency !== urgencyFilter) return false;
      if (typeFilter && evt.type !== typeFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (
          !evt.message?.toLowerCase().includes(q) &&
          !evt.title?.toLowerCase().includes(q) &&
          !evt.summary?.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [displayFeed, urgencyFilter, typeFilter, searchQuery]);

  useEffect(() => {
    if (!isScrollLocked && !isPaused && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [filteredFeed, isScrollLocked, isPaused]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setIsScrollLocked(scrollHeight - scrollTop - clientHeight > 40);
  };

  const copyAll = () => {
    const text = filteredFeed
      .map((e) => `[${e.timestamp}] [${e.type ?? '?'}] [${e.urgency ?? '?'}] ${e.message ?? ''}`)
      .join('\n');
    ignoreError(navigator.clipboard.writeText(text), 'clipboard.copyAll');
  };

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(filteredFeed, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `claw-output-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearFeed = () => {
    // This only clears local view — parent controls the actual feed
    setSearchQuery('');
    setUrgencyFilter('');
    setTypeFilter('');
  };

  const urgencyCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const evt of displayFeed) {
      const u = evt.urgency ?? 'info';
      counts[u] = (counts[u] ?? 0) + 1;
    }
    return counts;
  }, [displayFeed]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const evt of displayFeed) {
      const t = evt.type ?? 'output';
      counts[t] = (counts[t] ?? 0) + 1;
    }
    return counts;
  }, [displayFeed]);

  const currentUrgency = filteredFeed[0]?.urgency ?? 'info';

  const uniqueUrgencies = Object.keys(urgencyCounts);
  const uniqueTypes = Object.keys(typeCounts);

  const sparkline = useMemo(() => buildSparkline(displayFeed), [displayFeed]);

  return (
    <div className="flex flex-col h-full rounded-lg border border-[#1a1a1a] overflow-hidden">
      {/* Terminal header */}
      <div className="flex flex-col gap-2 px-3 py-2 bg-[#0d0d0d] border-b border-[#1a1a1a]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <div className="w-3 h-3 rounded-full bg-green-500" />
            </div>
            <span className="text-xs font-mono text-gray-500">claw output</span>
            <span
              className={`text-xs font-mono ${URGENCY_COLORS[currentUrgency] ?? 'text-gray-400'}`}
            >
              {filteredFeed.length === displayFeed.length
                ? `${displayFeed.length} events`
                : `${filteredFeed.length} / ${displayFeed.length}`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsScrollLocked((v) => !v)}
              className={`text-xs px-2 py-1 rounded font-mono border ${
                isScrollLocked
                  ? 'text-amber-400 border-amber-400/30'
                  : 'text-gray-500 border-gray-700'
              }`}
              title={isScrollLocked ? 'Unlock scroll' : 'Lock scroll'}
            >
              {isScrollLocked ? '🔒' : '🔓'}
            </button>
            <button
              onClick={() => setIsPaused((v) => !v)}
              className={`text-xs px-2 py-1 rounded font-mono border ${
                isPaused ? 'text-green-400 border-green-400/30' : 'text-gray-500 border-gray-700'
              }`}
              title={isPaused ? 'Resume feed' : 'Pause feed'}
            >
              {isPaused ? '▶' : '⏸'}
            </button>
            <button
              onClick={copyAll}
              className="text-xs px-2 py-1 rounded font-mono text-gray-500 border border-gray-700 hover:text-gray-300"
              title="Copy all"
            >
              📋
            </button>
            <button
              onClick={downloadJson}
              className="text-xs px-2 py-1 rounded font-mono text-gray-500 border border-gray-700 hover:text-gray-300"
              title="Download JSON"
            >
              ↓
            </button>
          </div>
        </div>

        {/* Filter row */}
        <div className="flex items-center gap-2">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search messages..."
            className="flex-1 px-2 py-1 text-xs rounded bg-[#1a1a1a] border border-gray-700 text-gray-300 font-mono placeholder:text-gray-600 focus:outline-none focus:border-gray-500"
          />
          <select
            value={urgencyFilter}
            onChange={(e) => setUrgencyFilter(e.target.value)}
            className="px-2 py-1 text-xs rounded bg-[#1a1a1a] border border-gray-700 text-gray-400 font-mono focus:outline-none focus:border-gray-500"
          >
            <option value="">All urgencies</option>
            {uniqueUrgencies.map((u) => (
              <option key={u} value={u}>
                {u} ({urgencyCounts[u]})
              </option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-2 py-1 text-xs rounded bg-[#1a1a1a] border border-gray-700 text-gray-400 font-mono focus:outline-none focus:border-gray-500"
          >
            <option value="">All types</option>
            {uniqueTypes.map((t) => (
              <option key={t} value={t}>
                {t} ({typeCounts[t]})
              </option>
            ))}
          </select>
          {(searchQuery || urgencyFilter || typeFilter) && (
            <button
              onClick={clearFeed}
              className="text-xs px-2 py-1 rounded font-mono text-red-400 border border-red-700 hover:text-red-300"
            >
              ✕
            </button>
          )}
        </div>

        {/* Summary pill rows — clickable filters for both urgency and type. */}
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(urgencyCounts).map(([u, n]) => {
            const isActive = urgencyFilter === u;
            const idle = URGENCY_PILL_IDLE[u] ?? 'text-gray-400 border-gray-700 bg-gray-500/5';
            const active = URGENCY_BG[u] ?? 'bg-gray-500/15 text-gray-300';
            return (
              <button
                key={u}
                onClick={() => setUrgencyFilter(isActive ? '' : u)}
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
                  isActive ? `${active} border-transparent` : `${idle} opacity-70 hover:opacity-100`
                }`}
                title={`${isActive ? 'Clear' : 'Filter to'} urgency: ${u}`}
              >
                {u} {n}
              </button>
            );
          })}
          {uniqueTypes.length > 0 && (
            <span className="text-[10px] font-mono text-gray-700 px-1 self-center">|</span>
          )}
          {Object.entries(typeCounts).map(([t, n]) => {
            const isActive = typeFilter === t;
            const idle = TYPE_PILL_IDLE[t] ?? 'text-gray-400 border-gray-700 bg-gray-500/5';
            const active = TYPE_PILL_ACTIVE[t] ?? 'bg-gray-500/15 text-gray-300 border-transparent';
            return (
              <button
                key={t}
                onClick={() => setTypeFilter(isActive ? '' : t)}
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
                  isActive ? active : `${idle} opacity-70 hover:opacity-100`
                }`}
                title={`${isActive ? 'Clear' : 'Filter to'} type: ${t}`}
              >
                {TYPE_PREFIX[t] ?? '›'} {t} {n}
              </button>
            );
          })}
        </div>

        {/* Event-rate sparkline — purely cosmetic, shows whether the claw is
            currently spamming output or has gone idle for a while. */}
        {sparkline.buckets.length > 0 && sparkline.max > 0 && (
          <div
            className="flex items-end gap-px h-6"
            title={`${formatRange(sparkline.rangeMs)}, peak ${sparkline.max}/bucket`}
          >
            {sparkline.buckets.map((n, i) => {
              const pct = Math.max(4, Math.round((n / sparkline.max) * 100));
              const isLast = i >= sparkline.buckets.length - 2 && n > 0;
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-sm transition-all ${
                    n === 0
                      ? 'bg-[#1a1a1a]'
                      : isLast
                        ? 'bg-emerald-400 animate-pulse'
                        : 'bg-emerald-500/40'
                  }`}
                  style={{ height: `${pct}%` }}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Terminal body */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto bg-[#0d0d0d] p-4 font-mono text-sm space-y-0.5"
        style={{ minHeight: 0 }}
      >
        {filteredFeed.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-600 text-sm">
              {displayFeed.length === 0
                ? 'No output yet — claw is initializing...'
                : 'No events match the current filter.'}
            </p>
          </div>
        ) : (
          filteredFeed.map((evt, i) => {
            const urgency = evt.urgency ?? 'info';
            const type = evt.type ?? 'output';
            const color = URGENCY_COLORS[urgency] ?? 'text-gray-300';
            const prefix = TYPE_PREFIX[type] ?? '›';
            return (
              <div
                key={`${evt.timestamp}-${i}`}
                className="flex gap-3 group hover:bg-white/5 py-0.5 rounded"
              >
                <span className="text-gray-600 shrink-0 text-xs w-28">
                  {timeAgo(evt.timestamp)}
                </span>
                <span className={`shrink-0 ${TYPE_COLORS[type] ?? color}`}>{prefix}</span>
                <span className={`${color} break-all`}>{evt.message}</span>
                {evt.title && (
                  <span className="text-gray-500 shrink-0 text-xs">
                    — {evt.title.slice(0, 60)}
                    {evt.title.length > 60 ? '…' : ''}
                  </span>
                )}
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

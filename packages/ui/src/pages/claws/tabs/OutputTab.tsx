import { useState, useEffect, useRef } from 'react';
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

export function OutputTab({ outputFeed }: { outputFeed: ClawOutputEvent[] }) {
  const [isPaused, setIsPaused] = useState(false);
  const [isScrollLocked, setIsScrollLocked] = useState(false);
  const [isCleared, setIsCleared] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const displayFeed = isCleared ? [] : outputFeed;

  useEffect(() => {
    if (!isScrollLocked && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [displayFeed, isScrollLocked, isPaused]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setIsScrollLocked(scrollHeight - scrollTop - clientHeight > 40);
  };

  const copyAll = () => {
    const text = displayFeed
      .map((e) => `[${e.timestamp}] [${e.type ?? '?'}] [${e.urgency ?? '?'}] ${e.message ?? ''}`)
      .join('\n');
    ignoreError(navigator.clipboard.writeText(text), 'clipboard.copyAll');
  };

  const urgency = displayFeed[0]?.urgency ?? 'normal';
  const totalUrgencyCounts = displayFeed.reduce<Record<string, number>>((acc, e) => {
    const u = e.urgency ?? 'info';
    acc[u] = (acc[u] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full rounded-lg border border-[#1a1a1a] overflow-hidden">
      {/* Terminal header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#0d0d0d] border-b border-[#1a1a1a]">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <div className="w-3 h-3 rounded-full bg-yellow-500" />
            <div className="w-3 h-3 rounded-full bg-green-500" />
          </div>
          <span className="text-xs font-mono text-gray-500">claw output</span>
          <span className={`text-xs font-mono ${URGENCY_COLORS[urgency] ?? 'text-gray-400'}`}>
            {displayFeed.length} events
          </span>
          {Object.entries(totalUrgencyCounts).map(([u, n]) => (
            <span
              key={u}
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${URGENCY_COLORS[u] ?? 'text-gray-500'} bg-${u}/10`}
            >
              {n} {u}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsScrollLocked((v) => !v)}
            className={`text-xs px-2 py-1 rounded font-mono border ${isScrollLocked ? 'text-amber-400 border-amber-400/30' : 'text-gray-500 border-gray-700'}`}
          >
            {isScrollLocked ? '🔒' : '🔓'}
          </button>
          <button
            onClick={() => setIsPaused((v) => !v)}
            className={`text-xs px-2 py-1 rounded font-mono border ${isPaused ? 'text-green-400 border-green-400/30' : 'text-gray-500 border-gray-700'}`}
          >
            {isPaused ? '▶' : '⏸'}
          </button>
          <button
            onClick={copyAll}
            className="text-xs px-2 py-1 rounded font-mono text-gray-500 border border-gray-700"
          >
            📋
          </button>
          <button
            onClick={() => setIsCleared(true)}
            className="text-xs px-2 py-1 rounded font-mono text-gray-500 border border-gray-700 hover:text-red-400"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Terminal body */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto bg-[#0d0d0d] p-4 font-mono text-sm space-y-0.5"
        style={{ minHeight: 0 }}
      >
        {displayFeed.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-600 text-sm">No output yet — claw is initializing...</p>
          </div>
        ) : (
          displayFeed.map((evt, i) => {
            const color = URGENCY_COLORS[evt.urgency ?? 'info'] ?? 'text-gray-300';
            const prefix = evt.type === 'report' ? '📋' : evt.type === 'progress' ? '⚡' : '›';
            return (
              <div key={`${evt.timestamp}-${i}`} className="flex gap-3 group">
                <span className="text-gray-600 shrink-0 text-xs w-28">
                  {timeAgo(evt.timestamp)}
                </span>
                <span className={`shrink-0 ${color}`}>{prefix}</span>
                <span className={`${color} break-all`}>{evt.message}</span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

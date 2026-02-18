/**
 * Tool Call Limit Panel
 *
 * Collapsible panel above chat input to set the maximum number of tool calls
 * per chat request. Persists to localStorage across sessions.
 *
 * - Preset buttons: 25, 50, 100, 200, 500, Unlimited
 * - Custom input for arbitrary values
 * - 0 = unlimited (no tool call cap)
 * - Default: 200 (matches AGENT_DEFAULT_MAX_TOOL_CALLS)
 */

import { useState, useCallback } from 'react';
import { ChevronDown, ChevronUp } from './icons';

const STORAGE_KEY = 'ownpilot_maxToolCalls';
const DEFAULT_LIMIT = 200;

const PRESETS = [
  { label: '25', value: 25 },
  { label: '50', value: 50 },
  { label: '100', value: 100 },
  { label: '200', value: 200 },
  { label: '500', value: 500 },
  { label: 'Unlimited', value: 0 },
] as const;

function loadLimit(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const n = parseInt(raw, 10);
      if (!isNaN(n) && n >= 0) return n;
    }
  } catch { /* localStorage unavailable */ }
  return DEFAULT_LIMIT;
}

function saveLimit(n: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(n));
  } catch { /* localStorage unavailable */ }
}

interface ToolCallLimitPanelProps {
  onChange?: (maxToolCalls: number) => void;
}

export function ToolCallLimitPanel({ onChange }: ToolCallLimitPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [limit, setLimit] = useState(loadLimit);

  const handleChange = useCallback((value: number) => {
    setLimit(value);
    saveLimit(value);
    onChange?.(value);
  }, [onChange]);

  const displayLabel = limit === 0 ? 'Unlimited' : String(limit);

  return (
    <div className="mb-2">
      {/* Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors group"
      >
        <svg className="w-3.5 h-3.5 text-text-muted dark:text-dark-text-muted group-hover:text-primary transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
        <span className="text-xs text-text-muted dark:text-dark-text-muted">
          Tool Calls
        </span>

        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
          limit === 0
            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
            : limit <= 50
              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
              : 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
        }`}>
          {displayLabel}
        </span>

        {isExpanded
          ? <ChevronUp className="w-3 h-3 text-text-muted dark:text-dark-text-muted ml-auto" />
          : <ChevronDown className="w-3 h-3 text-text-muted dark:text-dark-text-muted ml-auto" />}
      </button>

      {/* Expanded panel */}
      {isExpanded && (
        <div className="mt-1 px-2 py-2 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border space-y-2">
          <p className="text-[10px] text-text-muted dark:text-dark-text-muted">
            Max tool calls per message. 0 = unlimited.
          </p>

          {/* Preset buttons */}
          <div className="flex flex-wrap gap-1">
            {PRESETS.map(({ label, value }) => (
              <button
                key={value}
                type="button"
                onClick={() => handleChange(value)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors ${
                  limit === value
                    ? 'bg-primary/15 text-primary border-primary/30 ring-1 ring-primary/20'
                    : 'border-border dark:border-dark-border text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Custom input */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-muted dark:text-dark-text-muted uppercase w-12 shrink-0">Custom</span>
            <input
              type="number"
              min={0}
              max={1000}
              value={limit}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 0 && v <= 1000) handleChange(v);
              }}
              className="w-20 px-2 py-1 text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 text-text-primary dark:text-dark-text-primary"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Read the current max tool calls from localStorage.
 * Used by useChatStore to include in the request body.
 */
export function getMaxToolCalls(): number {
  return loadLimit();
}

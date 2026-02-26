/**
 * Thinking mode toggle for chat settings.
 * Allows enabling Anthropic extended/adaptive thinking.
 */

import { useState, useEffect } from 'react';
import { Brain, ChevronDown } from './icons';
import { useChatStore } from '../hooks/useChatStore';

const STORAGE_KEY = 'ownpilot_thinkingMode';

type ThinkingMode = 'off' | 'adaptive' | 'manual';

export function ThinkingToggle() {
  const { provider, setThinkingConfig } = useChatStore();

  const [mode, setMode] = useState<ThinkingMode>(() => {
    try {
      return (localStorage.getItem(STORAGE_KEY) as ThinkingMode) || 'off';
    } catch {
      return 'off';
    }
  });

  const [budgetTokens, setBudgetTokens] = useState(16000);
  const [expanded, setExpanded] = useState(false);

  // Only show for Anthropic provider
  const isAnthropic = provider?.toLowerCase().includes('anthropic');
  if (!isAnthropic) return null;

  // Sync mode changes to store
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* */
    }

    if (mode === 'off') {
      setThinkingConfig(null);
    } else if (mode === 'adaptive') {
      setThinkingConfig({ type: 'adaptive' });
    } else {
      setThinkingConfig({ type: 'enabled', budgetTokens });
    }
  }, [mode, budgetTokens, setThinkingConfig]);

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary transition-colors"
      >
        <Brain className="w-3.5 h-3.5" />
        <span>
          Thinking:{' '}
          {mode === 'off'
            ? 'Off'
            : mode === 'adaptive'
              ? 'Adaptive'
              : `Manual (${(budgetTokens / 1000).toFixed(0)}k)`}
        </span>
        <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="mt-2 p-3 rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-sm space-y-2">
          <div className="flex gap-2">
            {(['off', 'adaptive', 'manual'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  mode === m
                    ? 'bg-primary text-white'
                    : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary/80'
                }`}
              >
                {m === 'off' ? 'Off' : m === 'adaptive' ? 'Adaptive' : 'Manual'}
              </button>
            ))}
          </div>

          {mode === 'adaptive' && (
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              Model decides when and how deeply to think. Best for Opus 4.6 and Sonnet 4.6.
            </p>
          )}

          {mode === 'manual' && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-muted dark:text-dark-text-muted">Budget</span>
                <span className="text-xs font-mono text-text-secondary dark:text-dark-text-secondary">
                  {(budgetTokens / 1000).toFixed(0)}k tokens
                </span>
              </div>
              <input
                type="range"
                min={1024}
                max={128000}
                step={1024}
                value={budgetTokens}
                onChange={(e) => setBudgetTokens(Number(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none bg-bg-tertiary dark:bg-dark-bg-tertiary accent-primary"
              />
              <p className="text-xs text-text-muted dark:text-dark-text-muted">
                Fixed token budget for thinking. For Sonnet 4.5, Opus 4.5, and older models.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

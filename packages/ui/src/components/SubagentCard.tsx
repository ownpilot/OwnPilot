/**
 * SubagentCard — Collapsible inline card for subagent activity in chat stream.
 *
 * Shows: name, task, state badge, progress (turns/tool calls), tool call list,
 * result/error, cancel button. Subscribes to WS subagent events for real-time updates.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  ChevronDown,
  ChevronRight,
  XCircle,
  CheckCircle2,
  AlertCircle,
  Clock,
  Wrench,
  StopCircle,
} from './icons';
import { subagentsApi } from '../api/endpoints/subagents';
import type { SubagentSession, SubagentState } from '../api/endpoints/subagents';
import { useGateway } from '../hooks/useWebSocket';

// =============================================================================
// Constants
// =============================================================================

const STATE_COLORS: Record<SubagentState, string> = {
  pending: 'bg-yellow-500',
  running: 'bg-blue-500 animate-pulse',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
  cancelled: 'bg-gray-400 dark:bg-gray-600',
  timeout: 'bg-orange-500',
};

const STATE_LABELS: Record<SubagentState, string> = {
  pending: 'Pending',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  timeout: 'Timed Out',
};

// =============================================================================
// SubagentCard
// =============================================================================

interface SubagentCardProps {
  subagentId: string;
  /** Initial session data (avoids an extra fetch if we have it) */
  initialData?: SubagentSession;
  /** Called when the subagent completes/fails so the parent can update */
  onComplete?: (session: SubagentSession) => void;
}

export function SubagentCard({ subagentId, initialData, onComplete }: SubagentCardProps) {
  const { subscribe } = useGateway();

  const [session, setSession] = useState<SubagentSession | null>(initialData ?? null);
  const [expanded, setExpanded] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Fetch session data on mount if not provided
  useEffect(() => {
    if (!initialData) {
      subagentsApi
        .get(subagentId)
        .then(setSession)
        .catch(() => {
          /* Subagent may have been cleaned up */
        });
    }
  }, [subagentId, initialData]);

  // Subscribe to real-time WS events
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    unsubs.push(
      subscribe<{
        subagentId: string;
        turnsUsed: number;
        toolCallsUsed: number;
        lastToolName?: string;
      }>('subagent:progress', (data) => {
        if (data.subagentId !== subagentId) return;
        setSession((prev) =>
          prev ? { ...prev, turnsUsed: data.turnsUsed, toolCallsUsed: data.toolCallsUsed } : prev
        );
      })
    );

    unsubs.push(
      subscribe<{
        subagentId: string;
        state: SubagentState;
        result?: string;
        error?: string;
        durationMs?: number;
        turnsUsed?: number;
        toolCallsUsed?: number;
      }>('subagent:completed', (data) => {
        if (data.subagentId !== subagentId) return;
        setSession((prev) => {
          if (!prev) return prev;
          const updated: SubagentSession = {
            ...prev,
            state: data.state,
            result: data.result ?? prev.result,
            error: data.error ?? prev.error,
            durationMs: data.durationMs ?? prev.durationMs,
            turnsUsed: data.turnsUsed ?? prev.turnsUsed,
            toolCallsUsed: data.toolCallsUsed ?? prev.toolCallsUsed,
            completedAt: new Date().toISOString(),
          };
          onComplete?.(updated);
          return updated;
        });
      })
    );

    return () => unsubs.forEach((u) => u());
  }, [subagentId, subscribe, onComplete]);

  const handleCancel = useCallback(async () => {
    setCancelling(true);
    try {
      await subagentsApi.cancel(subagentId);
    } finally {
      setCancelling(false);
    }
  }, [subagentId]);

  if (!session) {
    return (
      <div className="rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary p-3 animate-pulse">
        <div className="h-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded w-1/3" />
      </div>
    );
  }

  const isActive = session.state === 'running' || session.state === 'pending';

  return (
    <div className="rounded-lg border border-border dark:border-dark-border bg-bg-tertiary/50 dark:bg-dark-bg-tertiary/50 overflow-hidden text-sm">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
      >
        <div className="text-text-muted dark:text-dark-text-muted">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>

        {/* State badge */}
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATE_COLORS[session.state]}`} />

        {/* Name */}
        <span className="font-medium text-text-secondary dark:text-dark-text-secondary truncate">
          {session.name}
        </span>

        {/* State label */}
        <span className="text-xs text-text-muted dark:text-dark-text-muted ml-auto flex-shrink-0">
          {STATE_LABELS[session.state]}
        </span>

        {/* Progress stats */}
        {(session.turnsUsed > 0 || session.toolCallsUsed > 0) && (
          <span className="text-xs text-text-muted dark:text-dark-text-muted flex-shrink-0">
            {session.turnsUsed}t / {session.toolCallsUsed}tc
          </span>
        )}

        {/* Duration */}
        {session.durationMs != null && (
          <span className="text-xs text-text-muted dark:text-dark-text-muted flex-shrink-0">
            {formatDuration(session.durationMs)}
          </span>
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border dark:border-dark-border px-3 py-2 space-y-3">
          {/* Task description */}
          <div>
            <span className="text-xs font-medium text-text-muted dark:text-dark-text-muted">
              Task
            </span>
            <p className="text-xs text-text-secondary dark:text-dark-text-secondary mt-0.5 whitespace-pre-wrap">
              {session.task}
            </p>
          </div>

          {/* Provider / Model */}
          <div className="flex gap-4 text-xs text-text-muted dark:text-dark-text-muted">
            <span>Provider: {session.provider}</span>
            <span>Model: {session.model}</span>
          </div>

          {/* Tool calls */}
          {session.toolCalls.length > 0 && (
            <div>
              <span className="text-xs font-medium text-text-muted dark:text-dark-text-muted flex items-center gap-1">
                <Wrench className="w-3 h-3" /> Tool Calls ({session.toolCalls.length})
              </span>
              <div className="mt-1 space-y-1 max-h-48 overflow-y-auto">
                {session.toolCalls.map((tc, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 text-xs rounded px-2 py-1 bg-bg-secondary dark:bg-dark-bg-secondary"
                  >
                    {tc.success ? (
                      <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-3 h-3 text-red-500 flex-shrink-0" />
                    )}
                    <span className="font-mono text-text-secondary dark:text-dark-text-secondary truncate">
                      {tc.tool}
                    </span>
                    {tc.durationMs > 0 && (
                      <span className="text-text-muted dark:text-dark-text-muted ml-auto flex-shrink-0">
                        {tc.durationMs}ms
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Result */}
          {session.result && (
            <div>
              <span className="text-xs font-medium text-green-600 dark:text-green-400 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Result
              </span>
              <p className="text-xs text-text-secondary dark:text-dark-text-secondary mt-0.5 whitespace-pre-wrap max-h-64 overflow-y-auto">
                {session.result}
              </p>
            </div>
          )}

          {/* Error */}
          {session.error && (
            <div>
              <span className="text-xs font-medium text-red-600 dark:text-red-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Error
              </span>
              <p className="text-xs text-red-600 dark:text-red-400 mt-0.5 whitespace-pre-wrap">
                {session.error}
              </p>
            </div>
          )}

          {/* Stats row */}
          <div className="flex items-center gap-3 text-xs text-text-muted dark:text-dark-text-muted pt-1 border-t border-border/50 dark:border-dark-border/50">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Spawned{' '}
              {new Date(session.spawnedAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {session.tokensUsed && (
              <span>{session.tokensUsed.prompt + session.tokensUsed.completion} tokens</span>
            )}
          </div>

          {/* Cancel button */}
          {isActive && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleCancel();
              }}
              disabled={cancelling}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30 rounded-md transition-colors disabled:opacity-50"
            >
              <StopCircle className="w-3.5 h-3.5" />
              {cancelling ? 'Cancelling...' : 'Cancel Subagent'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = Math.round(secs % 60);
  return `${mins}m ${remSecs}s`;
}

/**
 * Delay Config Panel — configuration for delay/wait workflow nodes.
 * Pauses workflow execution for a specified duration before continuing.
 */

import { useState, useCallback, useEffect } from 'react';
import { X, Trash2, Clock } from '../../icons';
import type { NodeExecutionStatus } from '../../../api/types';
import { OutputTreeBrowser } from '../OutputTreeBrowser';

import type { NodeConfigPanelProps } from '../NodeConfigPanel';
import {
  statusBadgeStyles,
  statusIcons,
  RetryAttemptsDisplay,
  OutputAliasField,
  INPUT_CLS,
} from '../NodeConfigPanel';

// ============================================================================
// Types
// ============================================================================

type DelayUnit = 'seconds' | 'minutes' | 'hours';

interface DelayNodeData {
  label?: string;
  duration?: string;
  unit?: DelayUnit;
  description?: string;
  executionStatus?: NodeExecutionStatus;
  executionDuration?: number;
  executionOutput?: unknown;
  executionError?: string;
  retryAttempts?: number;
}

// ============================================================================
// Constants
// ============================================================================

const UNIT_OPTIONS: { value: DelayUnit; label: string }[] = [
  { value: 'seconds', label: 'Seconds' },
  { value: 'minutes', label: 'Minutes' },
  { value: 'hours', label: 'Hours' },
];

// ============================================================================
// Helpers
// ============================================================================

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(2)}h`;
}

// ============================================================================
// Main component
// ============================================================================

export function DelayConfigPanel({
  node,
  upstreamNodes,
  onUpdate,
  onDelete,
  onClose,
  className = '',
}: NodeConfigPanelProps) {
  const data = node.data as DelayNodeData;

  const [label, setLabel] = useState(data.label ?? 'Delay');
  const [duration, setDuration] = useState(data.duration ?? '');
  const [unit, setUnit] = useState<DelayUnit>(data.unit ?? 'seconds');
  const [description, setDescription] = useState(data.description ?? '');

  const hasResults = !!(data.executionStatus as string) && data.executionStatus !== 'pending';
  const [activeTab, setActiveTab] = useState<'config' | 'results'>(
    hasResults ? 'results' : 'config'
  );

  useEffect(() => {
    setLabel(data.label ?? 'Delay');
    setDuration(data.duration ?? '');
    setUnit(data.unit ?? 'seconds');
    setDescription(data.description ?? '');
    setActiveTab(data.executionStatus && data.executionStatus !== 'pending' ? 'results' : 'config');
  }, [node.id]);

  useEffect(() => {
    if (hasResults) setActiveTab('results');
  }, [hasResults]);

  const pushUpdate = useCallback(
    (partial: Partial<DelayNodeData>) => {
      onUpdate(node.id, { ...data, ...partial });
    },
    [node.id, data, onUpdate]
  );

  const injectTemplate = useCallback(
    (template: string) => {
      setDuration((prev) => prev + template);
      pushUpdate({ duration: duration + template });
    },
    [duration, pushUpdate]
  );

  return (
    <div
      className={`flex flex-col border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary ${className}`}
    >
      {/* Header with tabs */}
      <div className="flex items-center gap-2 p-3 border-b border-border dark:border-dark-border">
        <div className="w-5 h-5 rounded-full bg-violet-500/20 flex items-center justify-center shrink-0">
          <Clock className="w-3 h-3 text-violet-600 dark:text-violet-400" />
        </div>
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary flex-1 truncate">
          {data.label ?? 'Delay'}
        </h3>
        {hasResults && (
          <div className="flex bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-md p-0.5 shrink-0">
            <button
              onClick={() => setActiveTab('config')}
              className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
                activeTab === 'config'
                  ? 'bg-bg-primary dark:bg-dark-bg-primary shadow-sm font-medium text-text-primary dark:text-dark-text-primary'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Config
            </button>
            <button
              onClick={() => setActiveTab('results')}
              className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
                activeTab === 'results'
                  ? 'bg-bg-primary dark:bg-dark-bg-primary shadow-sm font-medium text-text-primary dark:text-dark-text-primary'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Results
            </button>
          </div>
        )}
        <button
          onClick={onClose}
          className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {activeTab === 'results' ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* Status row */}
          <div className="flex items-center gap-2">
            {(() => {
              const status = data.executionStatus as NodeExecutionStatus;
              const StatusIcon = statusIcons[status];
              return (
                <>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${statusBadgeStyles[status]}`}
                  >
                    {StatusIcon && <StatusIcon className="w-3 h-3" />}
                    {status}
                  </span>
                  {(data.retryAttempts as number) > 0 && (
                    <RetryAttemptsDisplay
                      retryAttempts={data.retryAttempts as number}
                      status={String(data.executionStatus)}
                    />
                  )}
                </>
              );
            })()}
          </div>

          {/* Actual delay duration */}
          {data.executionDuration != null && (
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Actual Delay
              </label>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-mono font-medium bg-violet-500/10 text-violet-700 dark:text-violet-300 rounded-md">
                <Clock className="w-3.5 h-3.5" />
                {formatDuration(data.executionDuration as number)}
              </span>
            </div>
          )}

          {/* Error */}
          {data.executionError && (
            <div>
              <label className="block text-xs font-medium text-error mb-1">Error</label>
              <pre className="px-3 py-2 text-xs font-mono bg-error/5 border border-error/20 rounded-md overflow-x-auto max-h-32 overflow-y-auto text-error whitespace-pre-wrap break-words">
                {data.executionError as string}
              </pre>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {/* Label */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Label
              </label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onBlur={() => {
                  if (label !== data.label) pushUpdate({ label });
                }}
                className={INPUT_CLS}
              />
            </div>

            {/* Duration + Unit */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Duration
                <span className="ml-1 font-normal text-text-muted/60">
                  (supports {'{{templates}}'})
                </span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  onBlur={() => pushUpdate({ duration })}
                  className={`${INPUT_CLS} flex-1 font-mono text-xs`}
                  placeholder="5 or {{node_1.output.wait}}"
                />
                <select
                  value={unit}
                  onChange={(e) => {
                    const next = e.target.value as DelayUnit;
                    setUnit(next);
                    pushUpdate({ unit: next });
                  }}
                  className={`${INPUT_CLS} w-28`}
                >
                  {UNIT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <p className="mt-1 text-[10px] text-text-muted">
                Enter a numeric value or a template expression that resolves to a number.
              </p>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => pushUpdate({ description: description || undefined })}
                rows={2}
                className={`${INPUT_CLS} resize-none`}
                placeholder="Optional: why is this delay needed?"
              />
            </div>

            {/* Upstream outputs */}
            {upstreamNodes.length > 0 && (
              <OutputTreeBrowser upstreamNodes={upstreamNodes} onInsert={injectTemplate} />
            )}

            <OutputAliasField
              data={data as unknown as Record<string, unknown>}
              nodeId={node.id}
              onUpdate={onUpdate}
            />
          </div>

          {/* Delete button */}
          <div className="p-3 border-t border-border dark:border-dark-border">
            <button
              onClick={() => onDelete(node.id)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-error bg-error/10 hover:bg-error/20 rounded-md transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Delay
            </button>
          </div>
        </>
      )}
    </div>
  );
}

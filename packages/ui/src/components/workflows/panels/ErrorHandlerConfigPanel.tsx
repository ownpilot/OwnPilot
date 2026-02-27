/**
 * Error Handler Config Panel — configuration for error handling workflow nodes.
 * Catches and handles errors from upstream nodes, with optional continuation.
 */

import { useState, useCallback, useEffect } from 'react';
import { X, Trash2, ShieldAlert } from '../../icons';
import type { NodeExecutionStatus } from '../../../api/types';

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

interface ErrorHandlerNodeData {
  label?: string;
  description?: string;
  continueOnSuccess?: boolean;
  executionStatus?: NodeExecutionStatus;
  executionDuration?: number;
  executionOutput?: unknown;
  executionError?: string;
  retryAttempts?: number;
}

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

export function ErrorHandlerConfigPanel({
  node,
  upstreamNodes: _upstreamNodes,
  onUpdate,
  onDelete,
  onClose,
  className = '',
}: NodeConfigPanelProps) {
  const data = node.data as ErrorHandlerNodeData;

  const [label, setLabel] = useState(data.label ?? 'Error Handler');
  const [description, setDescription] = useState(data.description ?? '');
  const [continueOnSuccess, setContinueOnSuccess] = useState(data.continueOnSuccess ?? false);

  const hasResults = !!(data.executionStatus as string) && data.executionStatus !== 'pending';
  const [activeTab, setActiveTab] = useState<'config' | 'results'>(
    hasResults ? 'results' : 'config'
  );

  useEffect(() => {
    setLabel(data.label ?? 'Error Handler');
    setDescription(data.description ?? '');
    setContinueOnSuccess(data.continueOnSuccess ?? false);
    setActiveTab(data.executionStatus && data.executionStatus !== 'pending' ? 'results' : 'config');
  }, [node.id]);

  useEffect(() => {
    if (hasResults) setActiveTab('results');
  }, [hasResults]);

  const pushUpdate = useCallback(
    (partial: Partial<ErrorHandlerNodeData>) => {
      onUpdate(node.id, { ...data, ...partial });
    },
    [node.id, data, onUpdate]
  );

  return (
    <div
      className={`flex flex-col border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary ${className}`}
    >
      <div className="flex items-center gap-2 p-3 border-b border-border dark:border-dark-border">
        <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
          <ShieldAlert className="w-3 h-3 text-red-600 dark:text-red-400" />
        </div>
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary flex-1 truncate">
          {data.label ?? 'Error Handler'}
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

          {data.executionDuration != null && (
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Execution Time
              </label>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-mono font-medium bg-red-500/10 text-red-700 dark:text-red-300 rounded-md">
                <ShieldAlert className="w-3.5 h-3.5" />
                {formatDuration(data.executionDuration as number)}
              </span>
            </div>
          )}

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
                placeholder="What should happen when a node fails?"
              />
            </div>

            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={continueOnSuccess}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setContinueOnSuccess(next);
                    pushUpdate({ continueOnSuccess: next });
                  }}
                  className="w-4 h-4 rounded border-border dark:border-dark-border text-red-500 focus:ring-red-500 focus:ring-offset-0"
                />
                <span className="text-xs font-medium text-text-secondary dark:text-dark-text-secondary">
                  Continue on Success
                </span>
              </label>
              <p className="mt-1 ml-6 text-[10px] text-text-muted">
                When the error handler succeeds, continue executing downstream nodes of the failed
                node
              </p>
            </div>

            <OutputAliasField
              data={data as unknown as Record<string, unknown>}
              nodeId={node.id}
              onUpdate={onUpdate}
            />
          </div>

          <div className="p-3 border-t border-border dark:border-dark-border">
            <button
              onClick={() => onDelete(node.id)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-error bg-error/10 hover:bg-error/20 rounded-md transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Error Handler
            </button>
          </div>
        </>
      )}
    </div>
  );
}

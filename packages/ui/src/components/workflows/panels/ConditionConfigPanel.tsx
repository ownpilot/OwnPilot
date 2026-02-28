/**
 * Condition Config Panel — configuration for condition/branch workflow nodes.
 * Supports JS expressions that return truthy/falsy for branching logic.
 */

import { useState, useCallback, useEffect } from 'react';
import { X, Trash2, GitBranch } from '../../icons';
import type { ConditionNodeData } from '../ConditionNode';
import type { NodeExecutionStatus } from '../../../api/types';
import { OutputTreeBrowser } from '../OutputTreeBrowser';
import type { NodeConfigPanelProps } from '../NodeConfigPanel';
import {
  statusBadgeStyles,
  statusIcons,
  RetryTimeoutFields,
  OutputAliasField,
  RetryAttemptsDisplay,
  INPUT_CLS,
} from '../NodeConfigPanel';

export function ConditionConfigPanel({
  node,
  upstreamNodes,
  onUpdate,
  onDelete,
  onClose,
  className = '',
}: NodeConfigPanelProps) {
  const data = node.data as ConditionNodeData;

  const [label, setLabel] = useState(data.label ?? 'Condition');
  const [expression, setExpression] = useState(data.expression ?? '');
  const [description, setDescription] = useState(data.description ?? '');

  const hasResults = !!(data.executionStatus as string) && data.executionStatus !== 'pending';
  const [activeTab, setActiveTab] = useState<'config' | 'results'>(
    hasResults ? 'results' : 'config'
  );

  useEffect(() => {
    setLabel(data.label ?? 'Condition');
    setExpression(data.expression ?? '');
    setDescription(data.description ?? '');
    setActiveTab(data.executionStatus && data.executionStatus !== 'pending' ? 'results' : 'config');
  }, [node.id]);

  useEffect(() => {
    if (hasResults) setActiveTab('results');
  }, [hasResults]);

  const pushUpdate = useCallback(
    (partial: Partial<ConditionNodeData>) => {
      onUpdate(node.id, { ...data, ...partial });
    },
    [node.id, data, onUpdate]
  );

  const injectTemplate = useCallback(
    (template: string) => {
      setExpression((prev) => prev + template);
      pushUpdate({ expression: expression + template });
    },
    [expression, pushUpdate]
  );

  return (
    <div
      className={`flex flex-col border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary ${className}`}
    >
      {/* Header with tabs */}
      <div className="flex items-center gap-2 p-3 border-b border-border dark:border-dark-border">
        <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
          <GitBranch className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary flex-1 truncate">
          {data.label ?? 'Condition'}
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
                  {data.executionDuration != null && (
                    <span className="text-xs text-text-muted dark:text-dark-text-muted">
                      {(data.executionDuration as number) < 1000
                        ? `${data.executionDuration}ms`
                        : `${((data.executionDuration as number) / 1000).toFixed(1)}s`}
                    </span>
                  )}
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

          {/* Branch taken */}
          {data.branchTaken && (
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Branch Taken
              </label>
              <span
                className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${
                  data.branchTaken === 'true'
                    ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                    : 'bg-red-500/20 text-red-700 dark:text-red-300'
                }`}
              >
                {data.branchTaken === 'true' ? 'True' : 'False'}
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
                Expression
                <span className="ml-1 font-normal text-text-muted/60">
                  (JS — returns truthy/falsy)
                </span>
              </label>
              <textarea
                value={expression}
                onChange={(e) => setExpression(e.target.value)}
                onBlur={() => pushUpdate({ expression })}
                rows={3}
                className={`${INPUT_CLS} resize-y font-mono text-xs`}
                placeholder="node_1 > 10 || node_2.status === 'ok'"
              />
              <p className="mt-1 text-[10px] text-text-muted">
                Access upstream data by node ID:{' '}
                <code className="text-emerald-600 dark:text-emerald-400">node_1</code>,{' '}
                <code className="text-emerald-600 dark:text-emerald-400">node_2.field</code>
              </p>
            </div>

            {/* Quick presets */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Quick Expressions
              </label>
              <div className="flex flex-wrap gap-1">
                {['node_1 !== null', 'node_1 > 0', 'node_1.length > 0', "node_1 === 'value'"].map(
                  (preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setExpression(preset);
                        pushUpdate({ expression: preset });
                      }}
                      className={`px-2 py-0.5 text-[10px] font-mono rounded border transition-colors ${
                        expression === preset
                          ? 'bg-emerald-500/20 border-emerald-400 text-emerald-600 dark:text-emerald-400'
                          : 'bg-bg-tertiary dark:bg-dark-bg-tertiary border-border dark:border-dark-border text-text-muted hover:border-emerald-400/50'
                      }`}
                    >
                      {preset}
                    </button>
                  )
                )}
              </div>
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
                placeholder="Optional: what does this condition check?"
              />
            </div>

            {upstreamNodes.length > 0 && (
              <OutputTreeBrowser upstreamNodes={upstreamNodes} onInsert={injectTemplate} />
            )}
            <OutputAliasField
              data={data as unknown as Record<string, unknown>}
              nodeId={node.id}
              onUpdate={onUpdate}
            />

            <RetryTimeoutFields
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
              Delete Condition
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Switch Config Panel — configuration for switch/case workflow nodes.
 * Evaluates an expression and routes to a matching case branch.
 */

import { useState, useCallback, useEffect } from 'react';
import { X, Trash2, Shuffle, Plus } from '../../icons';
import type { NodeExecutionStatus } from '../../../api/types';
import { OutputTreeBrowser } from '../OutputTreeBrowser';
import { JsonTreeView } from '../JsonTreeView';
import type { NodeConfigPanelProps } from '../NodeConfigPanel';
import {
  statusBadgeStyles,
  statusIcons,
  OutputAliasField,
  RetryTimeoutFields,
  RetryAttemptsDisplay,
  INPUT_CLS,
} from '../NodeConfigPanel';

// ============================================================================
// Types
// ============================================================================

interface SwitchCase {
  label: string;
  value: string;
}

interface SwitchNodeData {
  label?: string;
  expression?: string;
  cases?: SwitchCase[];
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
  executionStatus?: NodeExecutionStatus;
  executionDuration?: number;
  executionOutput?: unknown;
  executionError?: string;
  retryAttempts?: number;
  evaluatedValue?: unknown;
  matchedCase?: string;
}

// ============================================================================
// Main component
// ============================================================================

export function SwitchConfigPanel({
  node,
  upstreamNodes,
  onUpdate,
  onDelete,
  onClose,
  className = '',
}: NodeConfigPanelProps) {
  const data = node.data as SwitchNodeData;

  const [label, setLabel] = useState(data.label ?? 'Switch');
  const [expression, setExpression] = useState(data.expression ?? '');
  const [cases, setCases] = useState<SwitchCase[]>(
    data.cases ?? [{ label: 'Case 1', value: '' }]
  );
  const [description, setDescription] = useState(data.description ?? '');

  const hasResults = !!(data.executionStatus as string) && data.executionStatus !== 'pending';
  const [activeTab, setActiveTab] = useState<'config' | 'results'>(
    hasResults ? 'results' : 'config'
  );

  useEffect(() => {
    setLabel(data.label ?? 'Switch');
    setExpression(data.expression ?? '');
    setCases(data.cases ?? [{ label: 'Case 1', value: '' }]);
    setDescription(data.description ?? '');
    setActiveTab(data.executionStatus && data.executionStatus !== 'pending' ? 'results' : 'config');
  }, [node.id]);

  useEffect(() => {
    if (hasResults) setActiveTab('results');
  }, [hasResults]);

  const pushUpdate = useCallback(
    (partial: Partial<SwitchNodeData>) => {
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

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard?.writeText(text);
  }, []);

  const updateCase = useCallback(
    (index: number, field: 'label' | 'value', value: string) => {
      const next = [...cases];
      const current = next[index]!;
      next[index] = { label: current.label, value: current.value, [field]: value };
      setCases(next);
      pushUpdate({ cases: next });
    },
    [cases, pushUpdate]
  );

  const addCase = useCallback(() => {
    const next = [...cases, { label: `Case ${cases.length + 1}`, value: '' }];
    setCases(next);
    pushUpdate({ cases: next });
  }, [cases, pushUpdate]);

  const removeCase = useCallback(
    (index: number) => {
      const next = cases.filter((_, i) => i !== index);
      setCases(next);
      pushUpdate({ cases: next });
    },
    [cases, pushUpdate]
  );

  return (
    <div
      className={`flex flex-col border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary ${className}`}
    >
      {/* Header with tabs */}
      <div className="flex items-center gap-2 p-3 border-b border-border dark:border-dark-border">
        <div className="w-5 h-5 rounded-full bg-cyan-500/20 flex items-center justify-center shrink-0">
          <Shuffle className="w-3 h-3 text-cyan-600 dark:text-cyan-400" />
        </div>
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary flex-1 truncate">
          {data.label ?? 'Switch'}
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

          {/* Evaluated value */}
          {data.evaluatedValue !== undefined && (
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Evaluated Value
              </label>
              {typeof data.evaluatedValue === 'object' && data.evaluatedValue !== null ? (
                <div className="px-2 py-1.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-md max-h-40 overflow-y-auto">
                  <JsonTreeView
                    data={data.evaluatedValue}
                    pathPrefix={`${node.id}.output.value`}
                    onClickPath={copyToClipboard}
                  />
                </div>
              ) : (
                <pre className="px-3 py-2 text-xs font-mono bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-md text-text-primary dark:text-dark-text-primary">
                  {String(data.evaluatedValue)}
                </pre>
              )}
            </div>
          )}

          {/* Matched case */}
          {data.matchedCase && (
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Branch Taken
              </label>
              <span className="inline-block px-2 py-0.5 text-xs font-medium rounded bg-cyan-500/20 text-cyan-700 dark:text-cyan-300">
                {data.matchedCase}
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

            {/* Expression */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Expression
                <span className="ml-1 font-normal text-text-muted/60">
                  (supports {'{{templates}}'})
                </span>
              </label>
              <textarea
                value={expression}
                onChange={(e) => setExpression(e.target.value)}
                onBlur={() => pushUpdate({ expression })}
                rows={3}
                className={`${INPUT_CLS} resize-y font-mono text-xs`}
                placeholder="{{node_1.output.status}} or node_1.type"
              />
              <p className="mt-1 text-[10px] text-text-muted">
                The evaluated result is matched against case values below.
              </p>
            </div>

            {/* Cases */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1.5">
                Cases
              </label>
              <div className="space-y-1.5">
                {cases.map((c, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={c.label}
                      onChange={(e) => updateCase(i, 'label', e.target.value)}
                      placeholder="Label"
                      className={`${INPUT_CLS} flex-1`}
                    />
                    <input
                      type="text"
                      value={c.value}
                      onChange={(e) => updateCase(i, 'value', e.target.value)}
                      placeholder="Match value"
                      className={`${INPUT_CLS} flex-1 font-mono text-xs`}
                    />
                    <button
                      type="button"
                      onClick={() => removeCase(i)}
                      className="p-1 text-text-muted hover:text-error transition-colors shrink-0"
                      title="Remove case"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addCase}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  Add Case
                </button>
              </div>
              <p className="mt-1 text-[10px] text-text-muted">
                Each case is compared against the expression result. First match wins; unmatched
                routes to default.
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
                placeholder="Optional: describe the branching logic"
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

            {/* Retry / Timeout */}
            <RetryTimeoutFields
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
              Delete Switch
            </button>
          </div>
        </>
      )}
    </div>
  );
}

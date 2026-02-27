/**
 * ForEach Config Panel — configuration for for-each loop workflow nodes.
 * Iterates over an array expression with configurable item variable,
 * max iterations, and error handling mode.
 */

import { useState, useCallback, useEffect } from 'react';
import { X, Trash2, RefreshCw } from '../../icons';
import type { ForEachNodeData } from '../ForEachNode';
import { OutputTreeBrowser } from '../OutputTreeBrowser';
import { TemplateValidator } from '../TemplateValidator';
import type { NodeConfigPanelProps } from '../NodeConfigPanel';
import { OutputAliasField, RetryTimeoutFields, RetryAttemptsDisplay, INPUT_CLS } from '../NodeConfigPanel';

const FOREACH_PRESETS = [
  '{{node_1.output}}',
  '{{node_1.output.items}}',
  '{{node_1.output.data}}',
] as const;

export function ForEachConfigPanel({
  node,
  upstreamNodes,
  onUpdate,
  onDelete,
  onClose,
  className = '',
}: NodeConfigPanelProps) {
  const data = node.data as ForEachNodeData;

  const [label, setLabel] = useState(data.label ?? 'ForEach');
  const [arrayExpression, setArrayExpression] = useState(data.arrayExpression ?? '');
  const [itemVariable, setItemVariable] = useState((data.itemVariable as string) ?? '');
  const [maxIterations, setMaxIterations] = useState(data.maxIterations ?? 100);
  const [onErrorMode, setOnErrorMode] = useState<'stop' | 'continue'>(
    (data.onError as 'stop' | 'continue') ?? 'stop'
  );
  const [description, setDescription] = useState((data.description as string) ?? '');

  const hasResults = !!(data.executionStatus as string) && data.executionStatus !== 'pending';
  const [activeTab, setActiveTab] = useState<'config' | 'results'>(
    hasResults ? 'results' : 'config'
  );

  useEffect(() => {
    setLabel(data.label ?? 'ForEach');
    setArrayExpression(data.arrayExpression ?? '');
    setItemVariable((data.itemVariable as string) ?? '');
    setMaxIterations(data.maxIterations ?? 100);
    setOnErrorMode((data.onError as 'stop' | 'continue') ?? 'stop');
    setDescription((data.description as string) ?? '');
    setActiveTab(data.executionStatus && data.executionStatus !== 'pending' ? 'results' : 'config');
  }, [node.id]);

  useEffect(() => {
    if (hasResults) setActiveTab('results');
  }, [hasResults]);

  const pushUpdate = useCallback(
    (partial: Partial<ForEachNodeData>) => {
      onUpdate(node.id, { ...data, ...partial });
    },
    [node.id, data, onUpdate]
  );

  const injectTemplate = useCallback(
    (template: string) => {
      setArrayExpression((prev) => prev + template);
      pushUpdate({ arrayExpression: arrayExpression + template });
    },
    [arrayExpression, pushUpdate]
  );

  return (
    <div
      className={`flex flex-col border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary ${className}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b border-border dark:border-dark-border">
        <div className="w-5 h-5 rounded-full bg-sky-500/20 flex items-center justify-center shrink-0">
          <RefreshCw className="w-3 h-3 text-sky-600 dark:text-sky-400" />
        </div>
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary flex-1 truncate">
          {data.label ?? 'ForEach'}
        </h3>
        {/* Tabs */}
        <div className="flex items-center gap-1 mr-1">
          <button
            onClick={() => setActiveTab('config')}
            className={`px-2 py-0.5 text-[10px] rounded ${activeTab === 'config' ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400' : 'text-text-muted hover:text-text-primary'}`}
          >
            Config
          </button>
          <button
            onClick={() => setActiveTab('results')}
            className={`px-2 py-0.5 text-[10px] rounded ${activeTab === 'results' ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400' : 'text-text-muted hover:text-text-primary'}`}
          >
            Results
          </button>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-text-muted hover:text-text-primary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {activeTab === 'results' ? (
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* Status badge */}
          <div className="flex items-center gap-2">
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Status
              </label>
              <span
                className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${
                  data.executionStatus === 'success'
                    ? 'bg-success/20 text-success'
                    : data.executionStatus === 'error'
                      ? 'bg-error/20 text-error'
                      : data.executionStatus === 'running'
                        ? 'bg-warning/20 text-warning'
                        : 'bg-text-muted/20 text-text-muted'
                }`}
              >
                {String(data.executionStatus ?? 'pending')}
              </span>
            </div>
            {(data.retryAttempts as number) > 0 && (
              <div className="pt-4">
                <RetryAttemptsDisplay
                  retryAttempts={data.retryAttempts as number}
                  status={String(data.executionStatus)}
                />
              </div>
            )}
          </div>

          {/* Iteration count */}
          {!!data.executionOutput && (
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Iterations
              </label>
              <span className="inline-block px-2 py-0.5 text-xs font-medium rounded bg-sky-500/20 text-sky-700 dark:text-sky-300">
                {String(
                  (data.executionOutput as { completedIterations?: number })?.completedIterations ??
                    0
                )}
                {' / '}
                {String((data.executionOutput as { count?: number })?.count ?? 0)} items
              </span>
            </div>
          )}

          {/* Error */}
          {!!data.executionError && (
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Error
              </label>
              <p className="text-xs text-error bg-error/10 px-2 py-1 rounded">
                {String(data.executionError)}
              </p>
            </div>
          )}

          {/* Duration */}
          {data.executionDuration != null && (
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Duration
              </label>
              <p className="text-xs text-text-primary dark:text-dark-text-primary">
                {(data.executionDuration as number) < 1000
                  ? `${data.executionDuration}ms`
                  : `${((data.executionDuration as number) / 1000).toFixed(1)}s`}
              </p>
            </div>
          )}

          {/* Collected results */}
          {!!data.executionOutput && (
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Collected Results
              </label>
              <pre className="text-[10px] font-mono bg-bg-tertiary dark:bg-dark-bg-tertiary p-2 rounded max-h-[300px] overflow-auto whitespace-pre-wrap text-text-primary dark:text-dark-text-primary">
                {JSON.stringify((data.executionOutput as { results?: unknown })?.results, null, 2)}
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

            {/* Array Expression */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Array to Iterate
                <span className="ml-1 font-normal text-text-muted/60">(template expression)</span>
              </label>
              <textarea
                value={arrayExpression}
                onChange={(e) => setArrayExpression(e.target.value)}
                onBlur={() => pushUpdate({ arrayExpression })}
                rows={2}
                className={`${INPUT_CLS} resize-y font-mono text-xs`}
                placeholder="{{node_1.output}} or {{node_1.output.items}}"
              />
              <p className="mt-1 text-[10px] text-text-muted">
                Use <code className="text-sky-600 dark:text-sky-400">{'{{nodeId.output}}'}</code> to
                reference upstream data
              </p>
              <TemplateValidator value={arrayExpression} upstreamNodes={upstreamNodes} />
            </div>

            {/* Quick Presets */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Quick Templates
              </label>
              <div className="flex flex-wrap gap-1">
                {FOREACH_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setArrayExpression(preset);
                      pushUpdate({ arrayExpression: preset });
                    }}
                    className={`px-2 py-0.5 text-[10px] font-mono rounded border transition-colors ${
                      arrayExpression === preset
                        ? 'bg-sky-500/20 border-sky-400 text-sky-600 dark:text-sky-400'
                        : 'bg-bg-tertiary dark:bg-dark-bg-tertiary border-border dark:border-dark-border text-text-muted hover:border-sky-400/50'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Item Variable */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Item Variable Name
                <span className="ml-1 font-normal text-text-muted/60">(optional alias)</span>
              </label>
              <input
                type="text"
                value={itemVariable}
                onChange={(e) => setItemVariable(e.target.value)}
                onBlur={() => pushUpdate({ itemVariable: itemVariable || undefined })}
                placeholder="e.g., issue, task, email"
                className={INPUT_CLS}
              />
              {itemVariable && (
                <p className="mt-1 text-[10px] text-text-muted">
                  Body nodes can use{' '}
                  <code className="text-sky-600 dark:text-sky-400">{`{{${itemVariable}}}`}</code>{' '}
                  for the current item
                </p>
              )}
            </div>

            {/* Max Iterations */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Max Iterations
                <span className="ml-1 font-normal text-text-muted/60">(safety limit)</span>
              </label>
              <input
                type="number"
                value={maxIterations}
                onChange={(e) => setMaxIterations(Number(e.target.value))}
                onBlur={() => pushUpdate({ maxIterations })}
                min={1}
                max={1000}
                className={INPUT_CLS}
              />
            </div>

            {/* On Error */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                On Error
              </label>
              <select
                value={onErrorMode}
                onChange={(e) => {
                  const val = e.target.value as 'stop' | 'continue';
                  setOnErrorMode(val);
                  pushUpdate({ onError: val });
                }}
                className={INPUT_CLS}
              >
                <option value="stop">Stop on first error</option>
                <option value="continue">Continue (collect errors)</option>
              </select>
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
                className={`${INPUT_CLS} resize-y`}
                placeholder="What does this loop do?"
              />
            </div>

            {/* Upstream Output Browser */}
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

          {/* Delete */}
          <div className="p-3 border-t border-border dark:border-dark-border">
            <button
              onClick={() => onDelete(node.id)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-error bg-error/10 hover:bg-error/20 rounded-md transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete ForEach
            </button>
          </div>
        </>
      )}
    </div>
  );
}

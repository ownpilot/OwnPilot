/**
 * Tool Config Panel — configuration for tool-type workflow nodes.
 * Schema-driven form fields with expression toggle, output tree browser,
 * and fallback JSON editor.
 */

import { useState, useCallback, useEffect } from 'react';
import { X, Trash2, Code, Play } from '../../icons';
import { toolsApi } from '../../../api';
import type { ToolParams } from '../../../pages/tools/types';
import type { ToolNodeData } from '../ToolNode';
import type { NodeExecutionStatus } from '../../../api/types';
import { SchemaFormFields } from '../SchemaFormFields';
import { OutputTreeBrowser } from '../OutputTreeBrowser';
import { JsonTreeView } from '../JsonTreeView';
import type { NodeConfigPanelProps } from '../NodeConfigPanel';
import {
  statusBadgeStyles,
  statusIcons,
  RetryTimeoutFields,
  OutputAliasField,
  RetryAttemptsDisplay,
} from '../NodeConfigPanel';

/** Module-level cache — persists for the page lifetime */
const schemaCache = new Map<string, ToolParams>();

export function ToolConfigPanel({
  node,
  upstreamNodes,
  onUpdate,
  onDelete,
  onClose,
  className = '',
}: NodeConfigPanelProps) {
  const data = node.data as ToolNodeData;
  const [label, setLabel] = useState(data.label);
  const [description, setDescription] = useState(data.description ?? '');
  const [argsJson, setArgsJson] = useState(() => JSON.stringify(data.toolArgs ?? {}, null, 2));
  const [argsError, setArgsError] = useState('');

  const hasResults = !!data.executionStatus && data.executionStatus !== 'pending';
  const [activeTab, setActiveTab] = useState<'config' | 'results'>(
    hasResults ? 'results' : 'config'
  );

  // Schema-driven form state
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [showJsonEditor, setShowJsonEditor] = useState(false);
  const [toolSchema, setToolSchema] = useState<ToolParams | undefined>(undefined);
  const [isTesting, setIsTesting] = useState(false);

  // Reset all local state when selected node changes
  useEffect(() => {
    setLabel(data.label);
    setDescription(data.description ?? '');
    setArgsJson(JSON.stringify(data.toolArgs ?? {}, null, 2));
    setArgsError('');
    setActiveTab(data.executionStatus && data.executionStatus !== 'pending' ? 'results' : 'config');
    setFocusedField(null);
    setShowJsonEditor(false);
  }, [node.id]);

  // Auto-switch to results when execution completes
  useEffect(() => {
    if (hasResults) setActiveTab('results');
  }, [hasResults]);

  // Fetch tool schema (cached)
  useEffect(() => {
    const cached = schemaCache.get(data.toolName);
    if (cached) {
      setToolSchema(cached);
      return;
    }

    let cancelled = false;
    toolsApi
      .list()
      .then((tools) => {
        if (cancelled) return;
        for (const t of tools) {
          schemaCache.set(t.name, t.parameters as ToolParams);
        }
        setToolSchema(schemaCache.get(data.toolName));
      })
      .catch(() => {
        // Non-critical — falls back to JSON editor
      });
    return () => {
      cancelled = true;
    };
  }, [data.toolName]);

  const handleLabelBlur = useCallback(() => {
    if (label !== data.label) {
      onUpdate(node.id, { ...data, label });
    }
  }, [label, data, node.id, onUpdate]);

  const handleDescriptionBlur = useCallback(() => {
    const desc = description || undefined;
    if (desc !== data.description) {
      onUpdate(node.id, { ...data, description: desc });
    }
  }, [description, data, node.id, onUpdate]);

  const handleArgsBlur = useCallback(() => {
    try {
      const parsed = JSON.parse(argsJson);
      setArgsError('');
      onUpdate(node.id, { ...data, toolArgs: parsed });
    } catch (e) {
      setArgsError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  }, [argsJson, data, node.id, onUpdate]);

  // Schema form: update a single field in toolArgs
  const handleFieldChange = useCallback(
    (name: string, value: unknown) => {
      const newArgs = { ...data.toolArgs };
      if (value === undefined) {
        delete newArgs[name];
      } else {
        newArgs[name] = value;
      }
      onUpdate(node.id, { ...data, toolArgs: newArgs });
      setArgsJson(JSON.stringify(newArgs, null, 2));
    },
    [data, node.id, onUpdate]
  );

  // Insert template from output tree — into focused field or clipboard
  const injectTemplate = useCallback(
    (template: string) => {
      if (focusedField) {
        handleFieldChange(focusedField, template);
      } else {
        navigator.clipboard?.writeText(template);
      }
    },
    [focusedField, handleFieldChange]
  );

  // Test-run a single node with current args
  const handleTestRun = useCallback(async () => {
    if (isTesting) return;
    setIsTesting(true);
    onUpdate(node.id, {
      ...data,
      executionStatus: 'running',
      executionError: undefined,
      executionOutput: undefined,
      executionDuration: undefined,
      resolvedArgs: undefined,
    });
    const startTime = Date.now();
    try {
      const result = await toolsApi.execute(data.toolName, data.toolArgs ?? {});
      const durationMs = Date.now() - startTime;
      onUpdate(node.id, {
        ...data,
        executionStatus: 'success',
        executionOutput: result,
        executionDuration: durationMs,
        resolvedArgs: data.toolArgs,
      });
    } catch (err) {
      const durationMs = Date.now() - startTime;
      onUpdate(node.id, {
        ...data,
        executionStatus: 'error',
        executionError: err instanceof Error ? err.message : 'Test run failed',
        executionDuration: durationMs,
      });
    } finally {
      setIsTesting(false);
    }
  }, [isTesting, data, node.id, onUpdate]);

  // Copy template path to clipboard (used in Results tab tree)
  const copyToClipboard = useCallback((template: string) => {
    navigator.clipboard?.writeText(template);
  }, []);

  const hasSchemaFields = toolSchema?.properties && Object.keys(toolSchema.properties).length > 0;

  return (
    <div
      className={`flex flex-col border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary ${className}`}
    >
      {/* Header with tabs */}
      <div className="flex items-center gap-2 p-3 border-b border-border dark:border-dark-border">
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary flex-1 truncate">
          {data.label || data.toolName}
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
        /* ================================================================
         * Results Tab — execution input/output viewer
         * ================================================================ */
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* Status badge + duration */}
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

          {/* Resolved Input Args */}
          {data.resolvedArgs &&
            Object.keys(data.resolvedArgs as Record<string, unknown>).length > 0 && (
              <div>
                <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                  Input (Resolved Args)
                </label>
                <div className="px-2 py-1.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-md max-h-48 overflow-y-auto">
                  <JsonTreeView
                    data={data.resolvedArgs}
                    pathPrefix={`${node.id}.input`}
                    onClickPath={copyToClipboard}
                  />
                </div>
              </div>
            )}

          {/* Output */}
          {data.executionOutput !== undefined && data.executionOutput !== null && (
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Output
              </label>
              <div className="px-2 py-1.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-md max-h-64 overflow-y-auto">
                <JsonTreeView
                  data={data.executionOutput}
                  pathPrefix={`${node.id}.output`}
                  onClickPath={copyToClipboard}
                />
              </div>
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

          {/* Tool name */}
          <div className="pt-2 border-t border-border dark:border-dark-border">
            <span className="text-[10px] text-text-muted dark:text-dark-text-muted">
              Tool: {data.toolName}
            </span>
          </div>
        </div>
      ) : (
        /* ================================================================
         * Config Tab — schema form + output tree + JSON fallback
         * ================================================================ */
        <>
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {/* Tool name (read-only) */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Tool
              </label>
              <div className="px-3 py-1.5 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-md text-text-primary dark:text-dark-text-primary">
                {data.toolName}
              </div>
            </div>

            {/* Label */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Label
              </label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onBlur={handleLabelBlur}
                className="w-full px-3 py-1.5 text-sm bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={handleDescriptionBlur}
                rows={2}
                className="w-full px-3 py-1.5 text-sm bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                placeholder="Optional description..."
              />
            </div>

            {/* Arguments — Schema form or JSON editor */}
            {!showJsonEditor && hasSchemaFields ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-text-muted dark:text-dark-text-muted">
                    Arguments
                  </label>
                  <button
                    onClick={() => {
                      setArgsJson(JSON.stringify(data.toolArgs ?? {}, null, 2));
                      setArgsError('');
                      setShowJsonEditor(true);
                    }}
                    className="flex items-center gap-1 text-[10px] text-text-muted hover:text-text-secondary transition-colors"
                    title="Switch to JSON editor"
                  >
                    <Code className="w-3 h-3" />
                    JSON
                  </button>
                </div>
                <SchemaFormFields
                  schema={toolSchema}
                  toolArgs={data.toolArgs}
                  onFieldChange={handleFieldChange}
                  onFieldFocus={setFocusedField}
                  focusedField={focusedField}
                />
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-text-muted dark:text-dark-text-muted">
                    Arguments (JSON)
                  </label>
                  {hasSchemaFields && (
                    <button
                      onClick={() => setShowJsonEditor(false)}
                      className="text-[10px] text-text-muted hover:text-text-secondary transition-colors"
                    >
                      Form Fields
                    </button>
                  )}
                </div>
                <textarea
                  value={argsJson}
                  onChange={(e) => setArgsJson(e.target.value)}
                  onBlur={handleArgsBlur}
                  rows={8}
                  spellCheck={false}
                  className={`w-full px-3 py-2 text-xs font-mono bg-bg-primary dark:bg-dark-bg-primary border rounded-md text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 resize-y ${
                    argsError
                      ? 'border-error focus:ring-error'
                      : 'border-border dark:border-dark-border focus:ring-primary'
                  }`}
                />
                {argsError && <p className="text-xs text-error mt-1">{argsError}</p>}
              </div>
            )}

            {/* Output tree browser — upstream node outputs */}
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

          {/* Test Run + Delete */}
          <div className="p-3 border-t border-border dark:border-dark-border space-y-2">
            <button
              onClick={handleTestRun}
              disabled={isTesting}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-white bg-primary hover:bg-primary-dark rounded-md transition-colors disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              {isTesting ? 'Running...' : 'Test Run'}
            </button>
            <button
              onClick={() => onDelete(node.id)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-error bg-error/10 hover:bg-error/20 rounded-md transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Node
            </button>
          </div>
        </>
      )}
    </div>
  );
}

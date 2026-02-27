/**
 * Code Config Panel — configuration for code-type workflow nodes.
 * Supports JavaScript, Python, and Shell languages with template expressions.
 */

import { useState, useCallback, useEffect } from 'react';
import { X, Trash2, Terminal } from '../../icons';
import type { CodeNodeData } from '../CodeNode';
import type { NodeExecutionStatus } from '../../../api/types';
import { OutputTreeBrowser } from '../OutputTreeBrowser';
import { JsonTreeView } from '../JsonTreeView';
import type { NodeConfigPanelProps } from '../NodeConfigPanel';
import {
  statusBadgeStyles,
  statusIcons,
  RetryTimeoutFields,
  OutputAliasField,
  RetryAttemptsDisplay,
  INPUT_CLS,
} from '../NodeConfigPanel';

const LANGUAGE_OPTIONS = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
  { value: 'shell', label: 'Shell' },
] as const;

export function CodeConfigPanel({
  node,
  upstreamNodes,
  onUpdate,
  onDelete,
  onClose,
  className = '',
}: NodeConfigPanelProps) {
  const data = node.data as CodeNodeData;

  const [label, setLabel] = useState(data.label ?? 'Code');
  const [language, setLanguage] = useState(data.language ?? 'javascript');
  const [code, setCode] = useState(data.code ?? '');
  const [description, setDescription] = useState(data.description ?? '');

  const hasResults = !!(data.executionStatus as string) && data.executionStatus !== 'pending';
  const [activeTab, setActiveTab] = useState<'config' | 'results'>(
    hasResults ? 'results' : 'config'
  );

  useEffect(() => {
    setLabel(data.label ?? 'Code');
    setLanguage(data.language ?? 'javascript');
    setCode(data.code ?? '');
    setDescription(data.description ?? '');
    setActiveTab(data.executionStatus && data.executionStatus !== 'pending' ? 'results' : 'config');
  }, [node.id]);

  useEffect(() => {
    if (hasResults) setActiveTab('results');
  }, [hasResults]);

  const pushUpdate = useCallback(
    (partial: Partial<CodeNodeData>) => {
      onUpdate(node.id, { ...data, ...partial });
    },
    [node.id, data, onUpdate]
  );

  const injectTemplate = useCallback(
    (template: string) => {
      setCode((prev) => prev + template);
      pushUpdate({ code: code + template });
    },
    [code, pushUpdate]
  );

  const copyToClipboard = useCallback((template: string) => {
    navigator.clipboard?.writeText(template);
  }, []);

  return (
    <div
      className={`flex flex-col border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary ${className}`}
    >
      <div className="flex items-center gap-2 p-3 border-b border-border dark:border-dark-border">
        <div className="w-5 h-5 rounded-full bg-teal-500/20 flex items-center justify-center shrink-0">
          <Terminal className="w-3 h-3 text-teal-600 dark:text-teal-400" />
        </div>
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary flex-1 truncate">
          {data.label ?? 'Code'}
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
          {data.executionOutput !== undefined && data.executionOutput !== null && (
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Output
              </label>
              {typeof data.executionOutput === 'string' ? (
                <pre className="px-3 py-2 text-xs font-mono bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-md overflow-x-auto max-h-64 overflow-y-auto text-text-primary dark:text-dark-text-primary whitespace-pre-wrap break-words">
                  {data.executionOutput}
                </pre>
              ) : (
                <div className="px-2 py-1.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-md max-h-64 overflow-y-auto">
                  <JsonTreeView
                    data={data.executionOutput}
                    pathPrefix={`${node.id}.output`}
                    onClickPath={copyToClipboard}
                  />
                </div>
              )}
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
          <div className="pt-2 border-t border-border dark:border-dark-border">
            <span className="text-[10px] text-text-muted dark:text-dark-text-muted">
              {language}
            </span>
          </div>
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
                Language
              </label>
              <select
                value={language}
                onChange={(e) => {
                  const lang = e.target.value as CodeNodeData['language'];
                  setLanguage(lang);
                  pushUpdate({ language: lang });
                }}
                className={INPUT_CLS}
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Code{' '}
                <span className="ml-1 font-normal text-text-muted/60">
                  (supports {'{{nodeId.output}}'} templates)
                </span>
              </label>
              <textarea
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onBlur={() => pushUpdate({ code })}
                rows={12}
                spellCheck={false}
                className={`${INPUT_CLS} resize-y font-mono text-xs`}
                placeholder={
                  language === 'javascript'
                    ? '// Your JavaScript code here\nconst result = 42;\nreturn result;'
                    : language === 'python'
                      ? '# Your Python code here\nresult = 42\nprint(result)'
                      : '# Shell script\necho "Hello"'
                }
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
                placeholder="Optional description..."
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
              <Trash2 className="w-3.5 h-3.5" /> Delete Code Node
            </button>
          </div>
        </>
      )}
    </div>
  );
}

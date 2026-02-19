/**
 * Node Configuration Panel — right panel in the workflow editor.
 * Two tabs: Config (edit label/args) and Results (view resolved input + output after execution).
 * Config tab: schema-driven form fields (from tool JSON Schema) with expression toggle,
 * output tree browser for upstream nodes, and fallback JSON editor.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { X, Trash2, Code, Play, CheckCircle2, XCircle, Activity, AlertCircle, Brain, GitBranch, Terminal, RefreshCw } from '../icons';
import { toolsApi, providersApi } from '../../api';
import type { ToolParams } from '../../pages/tools/types';
import type { ToolNodeData, ToolNodeType } from './ToolNode';
import type { TriggerNodeData } from './TriggerNode';
import type { LlmNodeData } from './LlmNode';
import type { ConditionNodeData } from './ConditionNode';
import type { CodeNodeData } from './CodeNode';
import type { TransformerNodeData } from './TransformerNode';
import type { NodeExecutionStatus } from '../../api/types';
import { SchemaFormFields } from './SchemaFormFields';
import { OutputTreeBrowser } from './OutputTreeBrowser';
import { JsonTreeView } from './JsonTreeView';
import { CRON_PRESETS, validateCron } from '../TriggerModal';
import type { Node } from '@xyflow/react';

interface NodeConfigPanelProps {
  node: ToolNodeType | Node;
  upstreamNodes: ToolNodeType[];
  onUpdate: (nodeId: string, data: Record<string, unknown>) => void;
  onDelete: (nodeId: string) => void;
  onClose: () => void;
  className?: string;
}

const statusBadgeStyles: Record<NodeExecutionStatus, string> = {
  pending: 'bg-text-muted/10 text-text-muted',
  running: 'bg-warning/10 text-warning',
  success: 'bg-success/10 text-success',
  error: 'bg-error/10 text-error',
  skipped: 'bg-text-muted/10 text-text-muted',
};

const statusIcons: Partial<Record<NodeExecutionStatus, React.ComponentType<{ className?: string }>>> = {
  running: Activity,
  success: CheckCircle2,
  error: XCircle,
  skipped: AlertCircle,
};

/** Module-level cache — persists for the page lifetime */
const schemaCache = new Map<string, ToolParams>();

export function NodeConfigPanel(props: NodeConfigPanelProps) {
  if (props.node.type === 'triggerNode') {
    return <TriggerConfigPanel {...props} />;
  }
  if (props.node.type === 'llmNode') {
    return <LlmConfigPanel {...props} />;
  }
  if (props.node.type === 'conditionNode') {
    return <ConditionConfigPanel {...props} />;
  }
  if (props.node.type === 'codeNode') {
    return <CodeConfigPanel {...props} />;
  }
  if (props.node.type === 'transformerNode') {
    return <TransformerConfigPanel {...props} />;
  }
  return <ToolConfigPanel {...props} />;
}

// ============================================================================
// Tool Config Panel (existing behavior)
// ============================================================================

function ToolConfigPanel({
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
  const [activeTab, setActiveTab] = useState<'config' | 'results'>(hasResults ? 'results' : 'config');

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
    toolsApi.list().then((tools) => {
      if (cancelled) return;
      for (const t of tools) {
        schemaCache.set(t.name, t.parameters as ToolParams);
      }
      setToolSchema(schemaCache.get(data.toolName));
    }).catch(() => {
      // Non-critical — falls back to JSON editor
    });
    return () => { cancelled = true; };
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
  const handleFieldChange = useCallback((name: string, value: unknown) => {
    const newArgs = { ...data.toolArgs };
    if (value === undefined) {
      delete newArgs[name];
    } else {
      newArgs[name] = value;
    }
    onUpdate(node.id, { ...data, toolArgs: newArgs });
    setArgsJson(JSON.stringify(newArgs, null, 2));
  }, [data, node.id, onUpdate]);

  // Insert template from output tree — into focused field or clipboard
  const injectTemplate = useCallback((template: string) => {
    if (focusedField) {
      handleFieldChange(focusedField, template);
    } else {
      navigator.clipboard?.writeText(template);
    }
  }, [focusedField, handleFieldChange]);

  // Test-run a single node with current args
  const handleTestRun = useCallback(async () => {
    if (isTesting) return;
    setIsTesting(true);
    onUpdate(node.id, { ...data, executionStatus: 'running', executionError: undefined, executionOutput: undefined, executionDuration: undefined, resolvedArgs: undefined });
    const startTime = Date.now();
    try {
      const result = await toolsApi.execute(data.toolName, data.toolArgs ?? {});
      const durationMs = Date.now() - startTime;
      onUpdate(node.id, { ...data, executionStatus: 'success', executionOutput: result, executionDuration: durationMs, resolvedArgs: data.toolArgs });
    } catch (err) {
      const durationMs = Date.now() - startTime;
      onUpdate(node.id, { ...data, executionStatus: 'error', executionError: err instanceof Error ? err.message : 'Test run failed', executionDuration: durationMs });
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
    <div className={`flex flex-col border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary ${className}`}>
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
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${statusBadgeStyles[status]}`}>
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
                </>
              );
            })()}
          </div>

          {/* Resolved Input Args */}
          {data.resolvedArgs && Object.keys(data.resolvedArgs as Record<string, unknown>).length > 0 && (
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Input (Resolved Args)
              </label>
              <div className="px-2 py-1.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-md max-h-48 overflow-y-auto">
                <JsonTreeView data={data.resolvedArgs} pathPrefix={`${node.id}.input`} onClickPath={copyToClipboard} />
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
                <JsonTreeView data={data.executionOutput} pathPrefix={`${node.id}.output`} onClickPath={copyToClipboard} />
              </div>
            </div>
          )}

          {/* Error */}
          {data.executionError && (
            <div>
              <label className="block text-xs font-medium text-error mb-1">
                Error
              </label>
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
                {argsError && (
                  <p className="text-xs text-error mt-1">{argsError}</p>
                )}
              </div>
            )}

            {/* Output tree browser — upstream node outputs */}
            {upstreamNodes.length > 0 && (
              <OutputTreeBrowser
                upstreamNodes={upstreamNodes}
                onInsert={injectTemplate}
              />
            )}
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

// ============================================================================
// Trigger Config Panel
// ============================================================================

const INPUT_CLS =
  'w-full px-3 py-1.5 text-sm bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary';

const TRIGGER_TYPES = [
  { value: 'manual', label: 'Manual (click to run)' },
  { value: 'schedule', label: 'Schedule (cron)' },
  { value: 'event', label: 'Event' },
  { value: 'condition', label: 'Condition' },
  { value: 'webhook', label: 'Webhook' },
] as const;

const CONDITION_OPTIONS = [
  { value: 'stale_goals', label: 'Stale Goals' },
  { value: 'upcoming_deadline', label: 'Upcoming Deadline' },
  { value: 'memory_threshold', label: 'Memory Threshold' },
  { value: 'low_progress', label: 'Low Progress' },
  { value: 'no_activity', label: 'No Activity' },
];

function TriggerConfigPanel({ node, onUpdate, onDelete, onClose, className = '' }: NodeConfigPanelProps) {
  const data = node.data as TriggerNodeData;

  const [label, setLabel] = useState(data.label ?? 'Trigger');
  const [triggerType, setTriggerType] = useState(data.triggerType ?? 'manual');
  const [cron, setCron] = useState(data.cron ?? '0 8 * * *');
  const [eventType, setEventType] = useState(data.eventType ?? '');
  const [condition, setCondition] = useState(data.condition ?? '');
  const [threshold, setThreshold] = useState(data.threshold ?? 0);
  const [webhookPath, setWebhookPath] = useState(data.webhookPath ?? '');

  // Reset on node change
  useEffect(() => {
    setLabel(data.label ?? 'Trigger');
    setTriggerType(data.triggerType ?? 'manual');
    setCron(data.cron ?? '0 8 * * *');
    setEventType(data.eventType ?? '');
    setCondition(data.condition ?? '');
    setThreshold(data.threshold ?? 0);
    setWebhookPath(data.webhookPath ?? '');
  }, [node.id]);

  // Push updates to parent
  const pushUpdate = useCallback((partial: Partial<TriggerNodeData>) => {
    onUpdate(node.id, { ...data, ...partial });
  }, [node.id, data, onUpdate]);

  const cronValidation = triggerType === 'schedule' ? validateCron(cron) : { valid: true };

  return (
    <div className={`flex flex-col border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b border-border dark:border-dark-border">
        <div className="w-5 h-5 rounded-full bg-violet-500/20 flex items-center justify-center shrink-0">
          <Play className="w-3 h-3 text-violet-600 dark:text-violet-400" />
        </div>
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary flex-1 truncate">
          {data.label ?? 'Trigger'}
        </h3>
        <button
          onClick={onClose}
          className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Config */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Label */}
        <div>
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Label</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => { if (label !== data.label) pushUpdate({ label }); }}
            className={INPUT_CLS}
          />
        </div>

        {/* Trigger Type */}
        <div>
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">When to run</label>
          <select
            value={triggerType}
            onChange={(e) => {
              const tt = e.target.value as TriggerNodeData['triggerType'];
              setTriggerType(tt);
              pushUpdate({ triggerType: tt });
            }}
            className={INPUT_CLS}
          >
            {TRIGGER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Schedule config */}
        {triggerType === 'schedule' && (
          <div className="space-y-2">
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Cron Expression
              </label>
              <input
                type="text"
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                onBlur={() => { if (cronValidation.valid) pushUpdate({ cron }); }}
                placeholder="0 8 * * *"
                className={`${INPUT_CLS} font-mono ${cron.trim() && !cronValidation.valid ? '!border-error !ring-error' : ''}`}
              />
              {cron.trim() && !cronValidation.valid ? (
                <p className="mt-1 text-[10px] text-error">{cronValidation.error}</p>
              ) : (
                <p className="mt-1 text-[10px] text-text-muted">minute hour day month weekday</p>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {CRON_PRESETS.map((preset) => (
                <button
                  key={preset.cron}
                  type="button"
                  onClick={() => { setCron(preset.cron); pushUpdate({ cron: preset.cron }); }}
                  className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                    cron === preset.cron
                      ? 'bg-violet-500/20 border-violet-400 text-violet-600 dark:text-violet-400'
                      : 'bg-bg-tertiary dark:bg-dark-bg-tertiary border-border dark:border-dark-border text-text-muted hover:border-violet-400/50'
                  }`}
                  title={preset.desc}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Event config */}
        {triggerType === 'event' && (
          <div>
            <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
              Event Type
            </label>
            <input
              type="text"
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              onBlur={() => pushUpdate({ eventType })}
              placeholder="e.g., file_created, goal_completed"
              className={INPUT_CLS}
            />
          </div>
        )}

        {/* Condition config */}
        {triggerType === 'condition' && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Condition
              </label>
              <select
                value={condition}
                onChange={(e) => { setCondition(e.target.value); pushUpdate({ condition: e.target.value }); }}
                className={INPUT_CLS}
              >
                <option value="">Select condition...</option>
                {CONDITION_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Threshold
              </label>
              <input
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                onBlur={() => pushUpdate({ threshold })}
                min={0}
                className={INPUT_CLS}
              />
            </div>
          </div>
        )}

        {/* Webhook config */}
        {triggerType === 'webhook' && (
          <div>
            <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
              Webhook Path
            </label>
            <input
              type="text"
              value={webhookPath}
              onChange={(e) => setWebhookPath(e.target.value)}
              onBlur={() => pushUpdate({ webhookPath })}
              placeholder="/hooks/my-trigger"
              className={INPUT_CLS}
            />
          </div>
        )}

        {/* Linked trigger info */}
        {data.triggerId && (
          <div className="pt-2 border-t border-border dark:border-dark-border">
            <span className="text-[10px] text-text-muted dark:text-dark-text-muted">
              Linked trigger: {data.triggerId}
            </span>
          </div>
        )}
      </div>

      {/* Delete */}
      <div className="p-3 border-t border-border dark:border-dark-border">
        <button
          onClick={() => onDelete(node.id)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-error bg-error/10 hover:bg-error/20 rounded-md transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete Trigger
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// LLM Config Panel
// ============================================================================

function LlmConfigPanel({
  node,
  upstreamNodes,
  onUpdate,
  onDelete,
  onClose,
  className = '',
}: NodeConfigPanelProps) {
  const data = node.data as LlmNodeData;

  const [label, setLabel] = useState(data.label ?? 'LLM');
  const [provider, setProvider] = useState(data.provider ?? '');
  const [model, setModel] = useState(data.model ?? '');
  const [systemPrompt, setSystemPrompt] = useState(data.systemPrompt ?? '');
  const [userMessage, setUserMessage] = useState(data.userMessage ?? '');
  const [temperature, setTemperature] = useState(data.temperature ?? 0.7);
  const [maxTokens, setMaxTokens] = useState(data.maxTokens ?? 4096);
  const [apiKey, setApiKey] = useState(data.apiKey ?? '');
  const [baseUrl, setBaseUrl] = useState(data.baseUrl ?? '');
  const [showAdvanced, setShowAdvanced] = useState(!!data.apiKey || !!data.baseUrl);

  // Available providers from API (with configuration status)
  const [providers, setProviders] = useState<Array<{ id: string; name: string; isConfigured: boolean }>>([]);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);

  const hasResults = !!(data.executionStatus as string) && data.executionStatus !== 'pending';
  const [activeTab, setActiveTab] = useState<'config' | 'results'>(hasResults ? 'results' : 'config');

  // Reset on node change
  useEffect(() => {
    setLabel(data.label ?? 'LLM');
    setProvider(data.provider ?? '');
    setModel(data.model ?? '');
    setSystemPrompt(data.systemPrompt ?? '');
    setUserMessage(data.userMessage ?? '');
    setTemperature(data.temperature ?? 0.7);
    setMaxTokens(data.maxTokens ?? 4096);
    setApiKey(data.apiKey ?? '');
    setBaseUrl(data.baseUrl ?? '');
    setShowAdvanced(!!(data.apiKey ?? data.baseUrl));
    setActiveTab(data.executionStatus && data.executionStatus !== 'pending' ? 'results' : 'config');
  }, [node.id]);

  useEffect(() => {
    if (hasResults) setActiveTab('results');
  }, [hasResults]);

  // Derived: configured providers sorted first
  const configuredProviders = useMemo(
    () => providers.filter((p) => p.isConfigured),
    [providers],
  );
  const isProviderConfigured = useMemo(
    () => configuredProviders.some((p) => p.id === provider),
    [configuredProviders, provider],
  );

  // Fetch available providers
  useEffect(() => {
    let cancelled = false;
    providersApi.list().then((resp) => {
      if (cancelled) return;
      const items = resp.providers.map((p) => ({
        id: p.id,
        name: p.name ?? p.id,
        isConfigured: 'isConfigured' in p ? !!(p as unknown as Record<string, unknown>).isConfigured : false,
      })).filter((p) => p.id);
      setProviders(items);
    }).catch(() => { /* non-critical */ });
    return () => { cancelled = true; };
  }, []);

  // Fetch models when provider changes, auto-select first if model empty
  useEffect(() => {
    if (!provider) { setModels([]); return; }
    let cancelled = false;
    providersApi.models(provider).then((resp) => {
      if (cancelled) return;
      const list = resp.models ?? [];
      setModels(list);
      // Auto-select first model when current model is empty
      const firstModel = list[0];
      if (!model && firstModel) {
        setModel(firstModel.id);
        onUpdate(node.id, { ...data, model: firstModel.id });
      }
    }).catch(() => { if (!cancelled) setModels([]); });
    return () => { cancelled = true; };
  }, [provider]);

  // Auto-select first configured provider when provider is empty/unconfigured
  useEffect(() => {
    const first = configuredProviders[0];
    if (first && !provider) {
      setProvider(first.id);
      onUpdate(node.id, { ...data, provider: first.id });
    }
  }, [configuredProviders.length]); // only on initial provider load

  // Auto-expand advanced section when provider is not configured (needs manual API key)
  useEffect(() => {
    if (providers.length > 0 && !isProviderConfigured && !apiKey) {
      setShowAdvanced(true);
    }
  }, [isProviderConfigured, providers.length]);

  const pushUpdate = useCallback((partial: Partial<LlmNodeData>) => {
    onUpdate(node.id, { ...data, ...partial });
  }, [node.id, data, onUpdate]);

  // Insert template from output tree
  const injectTemplate = useCallback((template: string) => {
    setUserMessage((prev) => prev + template);
    pushUpdate({ userMessage: userMessage + template });
  }, [userMessage, pushUpdate]);

  // Copy template path to clipboard
  const copyToClipboard = useCallback((template: string) => {
    navigator.clipboard?.writeText(template);
  }, []);

  return (
    <div className={`flex flex-col border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary ${className}`}>
      {/* Header with tabs */}
      <div className="flex items-center gap-2 p-3 border-b border-border dark:border-dark-border">
        <div className="w-5 h-5 rounded-full bg-indigo-500/20 flex items-center justify-center shrink-0">
          <Brain className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
        </div>
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary flex-1 truncate">
          {data.label ?? 'LLM'}
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
         * Results Tab — LLM output viewer
         * ================================================================ */
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* Status badge + duration */}
          <div className="flex items-center gap-2">
            {(() => {
              const status = data.executionStatus as NodeExecutionStatus;
              const StatusIcon = statusIcons[status];
              return (
                <>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${statusBadgeStyles[status]}`}>
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
                </>
              );
            })()}
          </div>

          {/* Output */}
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
                  <JsonTreeView data={data.executionOutput} pathPrefix={`${node.id}.output`} onClickPath={copyToClipboard} />
                </div>
              )}
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

          <div className="pt-2 border-t border-border dark:border-dark-border">
            <span className="text-[10px] text-text-muted dark:text-dark-text-muted">
              {provider} / {model}
            </span>
          </div>
        </div>
      ) : (
        /* ================================================================
         * Config Tab
         * ================================================================ */
        <>
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {/* Configured Providers — quick select */}
            {configuredProviders.length > 0 ? (
              <div>
                <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1.5">
                  Your AI Providers
                </label>
                <div className="flex flex-wrap gap-1">
                  {configuredProviders.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setProvider(p.id);
                        setModel('');
                        pushUpdate({ provider: p.id, model: '' });
                      }}
                      className={`px-2 py-1 text-[10px] rounded border transition-colors flex items-center gap-1 ${
                        provider === p.id
                          ? 'bg-indigo-500/20 border-indigo-400 text-indigo-600 dark:text-indigo-400'
                          : 'bg-bg-tertiary dark:bg-dark-bg-tertiary border-border dark:border-dark-border text-text-muted hover:border-indigo-400/50'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : providers.length > 0 ? (
              <div className="px-3 py-2 text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-md text-text-muted">
                No AI providers configured. Add API keys in <span className="font-medium">Settings → AI Providers</span>.
              </div>
            ) : null}

            {/* Label */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Label</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onBlur={() => { if (label !== data.label) pushUpdate({ label }); }}
                className={INPUT_CLS}
              />
            </div>

            {/* Provider */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Provider</label>
              {providers.length > 0 ? (
                <select
                  value={provider}
                  onChange={(e) => {
                    const p = e.target.value;
                    setProvider(p);
                    setModel('');
                    pushUpdate({ provider: p, model: '' });
                  }}
                  className={INPUT_CLS}
                >
                  {configuredProviders.length > 0 && (
                    <optgroup label="Configured">
                      {configuredProviders.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="Other">
                    {providers.filter((p) => !p.isConfigured).map((p) => (
                      <option key={p.id} value={p.id}>{p.name} (no key)</option>
                    ))}
                  </optgroup>
                </select>
              ) : (
                <input
                  type="text"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  onBlur={() => pushUpdate({ provider })}
                  placeholder="openai, anthropic, google..."
                  className={INPUT_CLS}
                />
              )}
              {/* Warning for unconfigured provider */}
              {providers.length > 0 && !isProviderConfigured && provider && (
                <p className="mt-1.5 px-2.5 py-1.5 text-[10px] bg-warning/10 text-warning border border-warning/20 rounded-md">
                  No API key for <span className="font-medium">{provider}</span>. Configure it in Settings → AI Providers, or enter a key below.
                </p>
              )}
            </div>

            {/* Model */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Model</label>
              {models.length > 0 ? (
                <select
                  value={model}
                  onChange={(e) => {
                    setModel(e.target.value);
                    pushUpdate({ model: e.target.value });
                  }}
                  className={INPUT_CLS}
                >
                  <option value="">Select model...</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.name || m.id}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  onBlur={() => pushUpdate({ model })}
                  placeholder="gpt-4o, claude-sonnet-4-5-20250514..."
                  className={INPUT_CLS}
                />
              )}
            </div>

            {/* System Prompt */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                System Prompt
              </label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                onBlur={() => pushUpdate({ systemPrompt: systemPrompt || undefined })}
                rows={3}
                className={`${INPUT_CLS} resize-y font-mono text-xs`}
                placeholder="You are a helpful assistant that..."
              />
            </div>

            {/* User Message */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                User Message
                <span className="ml-1 font-normal text-text-muted/60">
                  (supports {'{{nodeId.output}}'} templates)
                </span>
              </label>
              <textarea
                value={userMessage}
                onChange={(e) => setUserMessage(e.target.value)}
                onBlur={() => pushUpdate({ userMessage })}
                rows={4}
                className={`${INPUT_CLS} resize-y font-mono text-xs`}
                placeholder="Analyze the following data: {{node_1.output}}"
              />
            </div>

            {/* Temperature + Max Tokens */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                  Temperature
                </label>
                <input
                  type="number"
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                  onBlur={() => pushUpdate({ temperature })}
                  min={0}
                  max={2}
                  step={0.1}
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                  Max Tokens
                </label>
                <input
                  type="number"
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(Number(e.target.value))}
                  onBlur={() => pushUpdate({ maxTokens })}
                  min={1}
                  max={128000}
                  step={256}
                  className={INPUT_CLS}
                />
              </div>
            </div>

            {/* Advanced: custom API key + base URL */}
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-[10px] text-text-muted hover:text-text-secondary transition-colors"
              >
                {showAdvanced ? 'Hide' : 'Show'} Advanced (API Key, Base URL)
              </button>

              {showAdvanced && (
                <div className="mt-2 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                      Custom API Key
                      <span className="ml-1 font-normal text-text-muted/60">(overrides stored key)</span>
                    </label>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      onBlur={() => pushUpdate({ apiKey: apiKey || undefined })}
                      placeholder="sk-..."
                      className={INPUT_CLS}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                      Custom Base URL
                    </label>
                    <input
                      type="text"
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      onBlur={() => pushUpdate({ baseUrl: baseUrl || undefined })}
                      placeholder="https://api.example.com/v1"
                      className={INPUT_CLS}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Output tree browser — upstream node outputs */}
            {upstreamNodes.length > 0 && (
              <OutputTreeBrowser
                upstreamNodes={upstreamNodes}
                onInsert={injectTemplate}
              />
            )}
          </div>

          {/* Delete */}
          <div className="p-3 border-t border-border dark:border-dark-border">
            <button
              onClick={() => onDelete(node.id)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-error bg-error/10 hover:bg-error/20 rounded-md transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete LLM Node
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Condition Config Panel
// ============================================================================

function ConditionConfigPanel({
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
  const [activeTab, setActiveTab] = useState<'config' | 'results'>(hasResults ? 'results' : 'config');

  useEffect(() => {
    setLabel(data.label ?? 'Condition');
    setExpression(data.expression ?? '');
    setDescription(data.description ?? '');
    setActiveTab(data.executionStatus && data.executionStatus !== 'pending' ? 'results' : 'config');
  }, [node.id]);

  useEffect(() => {
    if (hasResults) setActiveTab('results');
  }, [hasResults]);

  const pushUpdate = useCallback((partial: Partial<ConditionNodeData>) => {
    onUpdate(node.id, { ...data, ...partial });
  }, [node.id, data, onUpdate]);

  const injectTemplate = useCallback((template: string) => {
    setExpression((prev) => prev + template);
    pushUpdate({ expression: expression + template });
  }, [expression, pushUpdate]);

  return (
    <div className={`flex flex-col border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary ${className}`}>
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
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${statusBadgeStyles[status]}`}>
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
                </>
              );
            })()}
          </div>

          {/* Branch taken */}
          {data.branchTaken && (
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Branch Taken</label>
              <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded ${
                data.branchTaken === 'true'
                  ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                  : 'bg-red-500/20 text-red-700 dark:text-red-300'
              }`}>
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
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Label</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onBlur={() => { if (label !== data.label) pushUpdate({ label }); }}
                className={INPUT_CLS}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Expression
                <span className="ml-1 font-normal text-text-muted/60">(JS — returns truthy/falsy)</span>
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
                Access upstream data by node ID: <code className="text-emerald-600 dark:text-emerald-400">node_1</code>, <code className="text-emerald-600 dark:text-emerald-400">node_2.field</code>
              </p>
            </div>

            {/* Quick presets */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Quick Expressions</label>
              <div className="flex flex-wrap gap-1">
                {['node_1 !== null', 'node_1 > 0', 'node_1.length > 0', "node_1 === 'value'"].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => { setExpression(preset); pushUpdate({ expression: preset }); }}
                    className={`px-2 py-0.5 text-[10px] font-mono rounded border transition-colors ${
                      expression === preset
                        ? 'bg-emerald-500/20 border-emerald-400 text-emerald-600 dark:text-emerald-400'
                        : 'bg-bg-tertiary dark:bg-dark-bg-tertiary border-border dark:border-dark-border text-text-muted hover:border-emerald-400/50'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Description</label>
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

// ============================================================================
// Code Config Panel
// ============================================================================

const LANGUAGE_OPTIONS = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
  { value: 'shell', label: 'Shell' },
] as const;

function CodeConfigPanel({
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
  const [activeTab, setActiveTab] = useState<'config' | 'results'>(hasResults ? 'results' : 'config');

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

  const pushUpdate = useCallback((partial: Partial<CodeNodeData>) => {
    onUpdate(node.id, { ...data, ...partial });
  }, [node.id, data, onUpdate]);

  const injectTemplate = useCallback((template: string) => {
    setCode((prev) => prev + template);
    pushUpdate({ code: code + template });
  }, [code, pushUpdate]);

  const copyToClipboard = useCallback((template: string) => {
    navigator.clipboard?.writeText(template);
  }, []);

  return (
    <div className={`flex flex-col border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary ${className}`}>
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
        <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors shrink-0">
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
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${statusBadgeStyles[status]}`}>
                    {StatusIcon && <StatusIcon className="w-3 h-3" />}
                    {status}
                  </span>
                  {data.executionDuration != null && (
                    <span className="text-xs text-text-muted dark:text-dark-text-muted">
                      {(data.executionDuration as number) < 1000 ? `${data.executionDuration}ms` : `${((data.executionDuration as number) / 1000).toFixed(1)}s`}
                    </span>
                  )}
                </>
              );
            })()}
          </div>
          {data.executionOutput !== undefined && data.executionOutput !== null && (
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Output</label>
              {typeof data.executionOutput === 'string' ? (
                <pre className="px-3 py-2 text-xs font-mono bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-md overflow-x-auto max-h-64 overflow-y-auto text-text-primary dark:text-dark-text-primary whitespace-pre-wrap break-words">{data.executionOutput}</pre>
              ) : (
                <div className="px-2 py-1.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-md max-h-64 overflow-y-auto">
                  <JsonTreeView data={data.executionOutput} pathPrefix={`${node.id}.output`} onClickPath={copyToClipboard} />
                </div>
              )}
            </div>
          )}
          {data.executionError && (
            <div>
              <label className="block text-xs font-medium text-error mb-1">Error</label>
              <pre className="px-3 py-2 text-xs font-mono bg-error/5 border border-error/20 rounded-md overflow-x-auto max-h-32 overflow-y-auto text-error whitespace-pre-wrap break-words">{data.executionError as string}</pre>
            </div>
          )}
          <div className="pt-2 border-t border-border dark:border-dark-border">
            <span className="text-[10px] text-text-muted dark:text-dark-text-muted">{language}</span>
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Label</label>
              <input type="text" value={label} onChange={(e) => setLabel(e.target.value)}
                onBlur={() => { if (label !== data.label) pushUpdate({ label }); }} className={INPUT_CLS} />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Language</label>
              <select value={language} onChange={(e) => { const lang = e.target.value as CodeNodeData['language']; setLanguage(lang); pushUpdate({ language: lang }); }} className={INPUT_CLS}>
                {LANGUAGE_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Code <span className="ml-1 font-normal text-text-muted/60">(supports {'{{nodeId.output}}'} templates)</span>
              </label>
              <textarea value={code} onChange={(e) => setCode(e.target.value)} onBlur={() => pushUpdate({ code })}
                rows={12} spellCheck={false} className={`${INPUT_CLS} resize-y font-mono text-xs`}
                placeholder={language === 'javascript' ? '// Your JavaScript code here\nconst result = 42;\nreturn result;' :
                  language === 'python' ? '# Your Python code here\nresult = 42\nprint(result)' : '# Shell script\necho "Hello"'} />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                onBlur={() => pushUpdate({ description: description || undefined })} rows={2}
                className={`${INPUT_CLS} resize-none`} placeholder="Optional description..." />
            </div>
            {upstreamNodes.length > 0 && <OutputTreeBrowser upstreamNodes={upstreamNodes} onInsert={injectTemplate} />}
          </div>
          <div className="p-3 border-t border-border dark:border-dark-border">
            <button onClick={() => onDelete(node.id)} className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-error bg-error/10 hover:bg-error/20 rounded-md transition-colors">
              <Trash2 className="w-3.5 h-3.5" /> Delete Code Node
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Transformer Config Panel
// ============================================================================

const TRANSFORMER_PRESETS = [
  'data.items.map(i => i.name)',
  'data.items.filter(i => i.active)',
  'JSON.parse(data)',
  "data.split('\\n')",
] as const;

function TransformerConfigPanel({
  node,
  upstreamNodes,
  onUpdate,
  onDelete,
  onClose,
  className = '',
}: NodeConfigPanelProps) {
  const data = node.data as TransformerNodeData;

  const [label, setLabel] = useState(data.label ?? 'Transform');
  const [expression, setExpression] = useState(data.expression ?? '');
  const [description, setDescription] = useState(data.description ?? '');

  const hasResults = !!(data.executionStatus as string) && data.executionStatus !== 'pending';
  const [activeTab, setActiveTab] = useState<'config' | 'results'>(hasResults ? 'results' : 'config');

  useEffect(() => {
    setLabel(data.label ?? 'Transform');
    setExpression(data.expression ?? '');
    setDescription(data.description ?? '');
    setActiveTab(data.executionStatus && data.executionStatus !== 'pending' ? 'results' : 'config');
  }, [node.id]);

  useEffect(() => {
    if (hasResults) setActiveTab('results');
  }, [hasResults]);

  const pushUpdate = useCallback((partial: Partial<TransformerNodeData>) => {
    onUpdate(node.id, { ...data, ...partial });
  }, [node.id, data, onUpdate]);

  const injectTemplate = useCallback((template: string) => {
    setExpression((prev) => prev + template);
    pushUpdate({ expression: expression + template });
  }, [expression, pushUpdate]);

  const copyToClipboard = useCallback((template: string) => {
    navigator.clipboard?.writeText(template);
  }, []);

  return (
    <div className={`flex flex-col border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary ${className}`}>
      <div className="flex items-center gap-2 p-3 border-b border-border dark:border-dark-border">
        <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
          <RefreshCw className="w-3 h-3 text-amber-600 dark:text-amber-400" />
        </div>
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary flex-1 truncate">
          {data.label ?? 'Transform'}
        </h3>
        {hasResults && (
          <div className="flex bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-md p-0.5 shrink-0">
            <button onClick={() => setActiveTab('config')} className={`px-2.5 py-1 text-[11px] rounded transition-colors ${activeTab === 'config' ? 'bg-bg-primary dark:bg-dark-bg-primary shadow-sm font-medium text-text-primary dark:text-dark-text-primary' : 'text-text-muted hover:text-text-secondary'}`}>Config</button>
            <button onClick={() => setActiveTab('results')} className={`px-2.5 py-1 text-[11px] rounded transition-colors ${activeTab === 'results' ? 'bg-bg-primary dark:bg-dark-bg-primary shadow-sm font-medium text-text-primary dark:text-dark-text-primary' : 'text-text-muted hover:text-text-secondary'}`}>Results</button>
          </div>
        )}
        <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors shrink-0">
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
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${statusBadgeStyles[status]}`}>
                    {StatusIcon && <StatusIcon className="w-3 h-3" />}
                    {status}
                  </span>
                  {data.executionDuration != null && (
                    <span className="text-xs text-text-muted dark:text-dark-text-muted">
                      {(data.executionDuration as number) < 1000 ? `${data.executionDuration}ms` : `${((data.executionDuration as number) / 1000).toFixed(1)}s`}
                    </span>
                  )}
                </>
              );
            })()}
          </div>
          {data.executionOutput !== undefined && data.executionOutput !== null && (
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Output</label>
              {typeof data.executionOutput === 'string' ? (
                <pre className="px-3 py-2 text-xs font-mono bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-md overflow-x-auto max-h-64 overflow-y-auto text-text-primary dark:text-dark-text-primary whitespace-pre-wrap break-words">{data.executionOutput}</pre>
              ) : (
                <div className="px-2 py-1.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-md max-h-64 overflow-y-auto">
                  <JsonTreeView data={data.executionOutput} pathPrefix={`${node.id}.output`} onClickPath={copyToClipboard} />
                </div>
              )}
            </div>
          )}
          {data.executionError && (
            <div>
              <label className="block text-xs font-medium text-error mb-1">Error</label>
              <pre className="px-3 py-2 text-xs font-mono bg-error/5 border border-error/20 rounded-md overflow-x-auto max-h-32 overflow-y-auto text-error whitespace-pre-wrap break-words">{data.executionError as string}</pre>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Label</label>
              <input type="text" value={label} onChange={(e) => setLabel(e.target.value)}
                onBlur={() => { if (label !== data.label) pushUpdate({ label }); }} className={INPUT_CLS} />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Expression <span className="ml-1 font-normal text-text-muted/60">(JS — transforms data)</span>
              </label>
              <textarea value={expression} onChange={(e) => setExpression(e.target.value)}
                onBlur={() => pushUpdate({ expression })} rows={4}
                className={`${INPUT_CLS} resize-y font-mono text-xs`}
                placeholder="data.items.filter(i => i.active).map(i => i.name)" />
              <p className="mt-1 text-[10px] text-text-muted">
                <code className="text-amber-600 dark:text-amber-400">data</code> = last upstream output.
                Also access by node ID: <code className="text-amber-600 dark:text-amber-400">node_1</code>
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Quick Transforms</label>
              <div className="flex flex-wrap gap-1">
                {TRANSFORMER_PRESETS.map((preset) => (
                  <button key={preset} type="button"
                    onClick={() => { setExpression(preset); pushUpdate({ expression: preset }); }}
                    className={`px-2 py-0.5 text-[10px] font-mono rounded border transition-colors ${
                      expression === preset
                        ? 'bg-amber-500/20 border-amber-400 text-amber-600 dark:text-amber-400'
                        : 'bg-bg-tertiary dark:bg-dark-bg-tertiary border-border dark:border-dark-border text-text-muted hover:border-amber-400/50'
                    }`}>{preset}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                onBlur={() => pushUpdate({ description: description || undefined })} rows={2}
                className={`${INPUT_CLS} resize-none`} placeholder="Optional: what does this transformation do?" />
            </div>
            {upstreamNodes.length > 0 && <OutputTreeBrowser upstreamNodes={upstreamNodes} onInsert={injectTemplate} />}
          </div>
          <div className="p-3 border-t border-border dark:border-dark-border">
            <button onClick={() => onDelete(node.id)} className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-error bg-error/10 hover:bg-error/20 rounded-md transition-colors">
              <Trash2 className="w-3.5 h-3.5" /> Delete Transformer
            </button>
          </div>
        </>
      )}
    </div>
  );
}

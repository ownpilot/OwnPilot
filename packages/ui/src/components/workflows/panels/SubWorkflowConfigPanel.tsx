/**
 * SubWorkflowConfigPanel — config for sub-workflow nodes.
 * Lets users select a target workflow and map input variables.
 */

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, GitBranch } from '../../icons';
import type { NodeConfigPanelProps } from '../NodeConfigPanel';
import type { SubWorkflowNodeData } from '../SubWorkflowNode';
import { OutputAliasField, RetryTimeoutFields } from '../NodeConfigPanel';
import { OutputTreeBrowser } from '../OutputTreeBrowser';
import { TemplateValidator } from '../TemplateValidator';
import { workflowsApi } from '../../../api/endpoints/workflows';

interface WorkflowOption {
  id: string;
  name: string;
}

// ============================================================================
// Main component
// ============================================================================

export function SubWorkflowConfigPanel({
  node,
  upstreamNodes,
  onUpdate,
  onDelete,
  onClose,
  className = '',
}: NodeConfigPanelProps) {
  const data = node.data as SubWorkflowNodeData;

  const [label, setLabel] = useState(data.label ?? 'Sub-Workflow');
  const [description, setDescription] = useState(data.description ?? '');
  const [subWorkflowId, setSubWorkflowId] = useState(data.subWorkflowId ?? '');
  const [_subWorkflowName, setSubWorkflowName] = useState(data.subWorkflowName ?? '');
  const [inputMapping, setInputMapping] = useState<Array<{ key: string; value: string }>>(
    Object.entries(data.inputMapping ?? {}).map(([key, value]) => ({ key, value }))
  );
  const [maxDepth, setMaxDepth] = useState(data.maxDepth ?? 5);
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);

  // Load available workflows
  useEffect(() => {
    workflowsApi
      .list({ limit: '100' })
      .then((resp) => {
        setWorkflows(
          resp.workflows
            .filter((w) => w.id !== node.id.split('_')[0]) // rough self-exclusion
            .map((w) => ({ id: w.id, name: w.name }))
        );
      })
      .catch(() => {});
  }, [node.id]);

  const save = useCallback(
    (updates: Partial<SubWorkflowNodeData>) => {
      onUpdate(node.id, { ...data, ...updates });
    },
    [node.id, data, onUpdate]
  );

  const handleWorkflowChange = useCallback(
    (id: string) => {
      const wf = workflows.find((w) => w.id === id);
      setSubWorkflowId(id);
      setSubWorkflowName(wf?.name ?? '');
      save({ subWorkflowId: id, subWorkflowName: wf?.name ?? '' });
    },
    [workflows, save]
  );

  const handleMappingChange = useCallback(
    (index: number, field: 'key' | 'value', val: string) => {
      const updated = [...inputMapping];
      updated[index] = { ...updated[index]!, [field]: val };
      setInputMapping(updated);
      const obj: Record<string, string> = {};
      for (const m of updated) {
        if (m.key.trim()) obj[m.key.trim()] = m.value;
      }
      save({ inputMapping: obj });
    },
    [inputMapping, save]
  );

  const addMapping = useCallback(() => {
    setInputMapping((prev) => [...prev, { key: '', value: '' }]);
  }, []);

  const removeMapping = useCallback(
    (index: number) => {
      const updated = inputMapping.filter((_, i) => i !== index);
      setInputMapping(updated);
      const obj: Record<string, string> = {};
      for (const m of updated) {
        if (m.key.trim()) obj[m.key.trim()] = m.value;
      }
      save({ inputMapping: obj });
    },
    [inputMapping, save]
  );

  const injectTemplate = useCallback((template: string) => {
    navigator.clipboard?.writeText(template);
  }, []);

  return (
    <div
      className={`flex flex-col border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary overflow-y-auto ${className}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border dark:border-dark-border">
        <GitBranch className="w-4 h-4 text-indigo-500" />
        <h3 className="text-xs font-semibold text-text-primary dark:text-dark-text-primary flex-1 truncate">
          Sub-Workflow
        </h3>
        <button
          onClick={onClose}
          className="text-[10px] text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary"
        >
          ESC
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* Label */}
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-text-secondary dark:text-dark-text-secondary uppercase tracking-wide">
            Label
          </label>
          <input
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              save({ label: e.target.value });
            }}
            className="w-full px-2 py-1 text-xs bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary"
          />
        </div>

        {/* Description */}
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-text-secondary dark:text-dark-text-secondary uppercase tracking-wide">
            Description
          </label>
          <input
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              save({ description: e.target.value });
            }}
            placeholder="Optional description"
            className="w-full px-2 py-1 text-xs bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary"
          />
        </div>

        {/* Target Workflow */}
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-text-secondary dark:text-dark-text-secondary uppercase tracking-wide">
            Target Workflow
          </label>
          <select
            value={subWorkflowId}
            onChange={(e) => handleWorkflowChange(e.target.value)}
            className="w-full px-2 py-1 text-xs bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary"
          >
            <option value="">Select a workflow...</option>
            {workflows.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>

        {/* Max Depth */}
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-text-secondary dark:text-dark-text-secondary uppercase tracking-wide">
            Max Recursion Depth
          </label>
          <input
            type="number"
            min={1}
            max={10}
            value={maxDepth}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10) || 5;
              setMaxDepth(v);
              save({ maxDepth: v });
            }}
            className="w-full px-2 py-1 text-xs bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary"
          />
          <p className="text-[10px] text-text-muted dark:text-dark-text-muted">
            Prevents infinite recursion (default: 5)
          </p>
        </div>

        {/* Input Mapping */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-medium text-text-secondary dark:text-dark-text-secondary uppercase tracking-wide">
              Input Mapping
            </label>
            <button
              onClick={addMapping}
              className="flex items-center gap-0.5 text-[10px] text-brand dark:text-dark-brand hover:underline"
            >
              <Plus className="w-2.5 h-2.5" /> Add
            </button>
          </div>
          <p className="text-[10px] text-text-muted dark:text-dark-text-muted">
            {
              'Map variables into the sub-workflow. Key = variable name, Value = template expression (e.g. {{node_1.output}})'
            }
          </p>
          {inputMapping.map((m, i) => (
            <div key={i} className="space-y-0.5">
              <div className="flex items-center gap-1">
                <input
                  value={m.key}
                  onChange={(e) => handleMappingChange(i, 'key', e.target.value)}
                  placeholder="variable"
                  className="flex-1 px-2 py-1 text-xs bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary"
                />
                <span className="text-[10px] text-text-muted">=</span>
                <input
                  value={m.value}
                  onChange={(e) => handleMappingChange(i, 'value', e.target.value)}
                  placeholder="{{node_2.output}}"
                  className="flex-1 px-2 py-1 text-xs bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary"
                />
                <button
                  onClick={() => removeMapping(i)}
                  className="p-0.5 text-text-muted hover:text-error"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <TemplateValidator value={m.value} upstreamNodes={upstreamNodes} />
            </div>
          ))}
        </div>

        {/* Upstream outputs browser */}
        {upstreamNodes.length > 0 && (
          <OutputTreeBrowser upstreamNodes={upstreamNodes} onInsert={injectTemplate} />
        )}

        {/* Output Alias */}
        <OutputAliasField data={data} nodeId={node.id} onUpdate={onUpdate} />

        {/* Retry / Timeout */}
        <RetryTimeoutFields data={data} nodeId={node.id} onUpdate={onUpdate} />

        {/* Execution results */}
        {data.executionStatus && data.executionStatus !== 'pending' && (
          <div className="pt-2 border-t border-border dark:border-dark-border space-y-1">
            <div className="flex items-center gap-2">
              <span
                className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
                  data.executionStatus === 'success'
                    ? 'bg-success/20 text-success'
                    : data.executionStatus === 'error'
                      ? 'bg-error/20 text-error'
                      : data.executionStatus === 'running'
                        ? 'bg-warning/20 text-warning'
                        : 'bg-text-muted/20 text-text-muted'
                }`}
              >
                {(data.executionStatus as string).toUpperCase()}
              </span>
              {data.executionDuration != null && (
                <span className="text-[10px] text-text-muted dark:text-dark-text-muted">
                  {(data.executionDuration as number) < 1000
                    ? `${data.executionDuration}ms`
                    : `${((data.executionDuration as number) / 1000).toFixed(1)}s`}
                </span>
              )}
            </div>
            {data.executionError && (
              <p className="text-xs text-error break-words">{data.executionError as string}</p>
            )}
          </div>
        )}

        {/* Delete */}
        <div className="pt-2 border-t border-border dark:border-dark-border">
          <button
            onClick={() => onDelete(node.id)}
            className="w-full px-3 py-1.5 text-xs font-medium text-error hover:bg-error/10 border border-error/30 rounded-md transition-colors"
          >
            Delete Node
          </button>
        </div>
      </div>
    </div>
  );
}

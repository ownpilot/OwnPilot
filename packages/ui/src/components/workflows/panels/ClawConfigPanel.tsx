/**
 * ClawConfigPanel — config for Claw agent nodes.
 * Configures the agent name, mission, run mode, sandbox, and wait behavior.
 */

import { useState, useCallback } from 'react';
import { Bot } from '../../icons';
import type { NodeConfigPanelProps } from '../NodeConfigPanel';
import type { ClawNodeData } from '../ClawNode';
import { OutputAliasField } from '../NodeConfigPanel';
import { OutputTreeBrowser } from '../OutputTreeBrowser';
import { TemplateValidator } from '../TemplateValidator';

const MODES = [
  { value: 'single-shot', label: 'Single-shot (run once)' },
  { value: 'continuous', label: 'Continuous' },
  { value: 'interval', label: 'Interval' },
  { value: 'event', label: 'Event-driven' },
] as const;

const SANDBOXES = [
  { value: 'auto', label: 'Auto' },
  { value: 'docker', label: 'Docker' },
  { value: 'local', label: 'Local' },
] as const;

// ============================================================================
// Main component
// ============================================================================

export function ClawConfigPanel({
  node,
  upstreamNodes,
  onUpdate,
  onDelete,
  onClose,
  className = '',
}: NodeConfigPanelProps) {
  const data = node.data as ClawNodeData;

  const [label, setLabel] = useState(data.label ?? 'Claw Agent');
  const [description, setDescription] = useState(data.description ?? '');
  const [name, setName] = useState(data.name ?? '');
  const [mission, setMission] = useState(data.mission ?? '');
  const [timeoutMs, setTimeoutMs] = useState<number | undefined>(data.timeoutMs);

  const save = useCallback(
    (updates: Partial<ClawNodeData>) => {
      onUpdate(node.id, { ...data, ...updates });
    },
    [node.id, data, onUpdate]
  );

  const injectTemplate = useCallback(
    (template: string) => {
      const updated = mission + template;
      setMission(updated);
      save({ mission: updated });
    },
    [mission, save]
  );

  return (
    <div
      className={`flex flex-col border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary overflow-y-auto ${className}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border dark:border-dark-border">
        <Bot className="w-4 h-4 text-orange-500" />
        <h3 className="text-xs font-semibold text-text-primary dark:text-dark-text-primary flex-1 truncate">
          Claw Agent
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

        {/* Agent Name */}
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-text-secondary dark:text-dark-text-secondary uppercase tracking-wide">
            Agent Name <span className="text-error">*</span>
          </label>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              save({ name: e.target.value });
            }}
            placeholder="e.g. Research Agent"
            className="w-full px-2 py-1 text-xs bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary"
          />
          <TemplateValidator value={name} upstreamNodes={upstreamNodes} />
        </div>

        {/* Mission */}
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-text-secondary dark:text-dark-text-secondary uppercase tracking-wide">
            Mission <span className="text-error">*</span>
          </label>
          <textarea
            value={mission}
            onChange={(e) => {
              setMission(e.target.value);
              save({ mission: e.target.value });
            }}
            placeholder="What should this agent accomplish?"
            rows={4}
            className="w-full px-2 py-1 text-xs bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary resize-none"
          />
          <p className="text-[10px] text-text-muted dark:text-dark-text-muted">
            {'Mission statement for the autonomous agent. Supports {{template}} expressions.'}
          </p>
          <TemplateValidator value={mission} upstreamNodes={upstreamNodes} />
        </div>

        {/* Mode */}
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-text-secondary dark:text-dark-text-secondary uppercase tracking-wide">
            Mode
          </label>
          <select
            value={data.mode ?? 'single-shot'}
            onChange={(e) => save({ mode: e.target.value as ClawNodeData['mode'] })}
            className="w-full px-2 py-1 text-xs bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary"
          >
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* Sandbox */}
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-text-secondary dark:text-dark-text-secondary uppercase tracking-wide">
            Sandbox
          </label>
          <select
            value={data.sandbox ?? 'auto'}
            onChange={(e) => save({ sandbox: e.target.value as ClawNodeData['sandbox'] })}
            className="w-full px-2 py-1 text-xs bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary"
          >
            {SANDBOXES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {/* Wait for completion */}
        <div className="flex items-center justify-between">
          <label className="text-xs text-text-secondary dark:text-dark-text-secondary">
            Wait for completion
          </label>
          <input
            type="checkbox"
            checked={data.waitForCompletion ?? true}
            onChange={(e) => save({ waitForCompletion: e.target.checked })}
            className="w-3.5 h-3.5 accent-orange-500"
          />
        </div>

        {/* Timeout */}
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-text-secondary dark:text-dark-text-secondary uppercase tracking-wide">
            Timeout (ms)
          </label>
          <input
            type="number"
            min={0}
            step={1000}
            value={timeoutMs ?? ''}
            onChange={(e) => {
              const v = e.target.value ? parseInt(e.target.value, 10) : undefined;
              setTimeoutMs(v);
              save({ timeoutMs: v });
            }}
            placeholder="600000 (10 min default)"
            className="w-full px-2 py-1 text-xs bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary"
          />
          <p className="text-[10px] text-text-muted dark:text-dark-text-muted">
            Max wait time when waiting for completion. Leave empty for the 10-minute default.
          </p>
        </div>

        {/* Upstream outputs browser */}
        {upstreamNodes.length > 0 && (
          <OutputTreeBrowser upstreamNodes={upstreamNodes} onInsert={injectTemplate} />
        )}

        {/* Output Alias */}
        <OutputAliasField data={data} nodeId={node.id} onUpdate={onUpdate} />

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
            {data.executionError && <p className="text-xs text-error">{data.executionError}</p>}
            {data.executionOutput != null && (
              <pre className="text-[10px] p-2 rounded bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border overflow-x-auto max-h-40">
                {typeof data.executionOutput === 'string'
                  ? data.executionOutput
                  : JSON.stringify(data.executionOutput, null, 2)}
              </pre>
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

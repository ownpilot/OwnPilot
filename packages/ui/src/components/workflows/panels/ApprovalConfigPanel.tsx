/**
 * ApprovalConfigPanel — config for approval gate nodes.
 * Configures the approval message and optional timeout.
 */

import { useState, useCallback } from 'react';
import { ShieldCheck } from '../../icons';
import type { NodeConfigPanelProps } from '../NodeConfigPanel';
import type { ApprovalNodeData } from '../ApprovalNode';
import { OutputAliasField } from '../NodeConfigPanel';
import { OutputTreeBrowser } from '../OutputTreeBrowser';
import { TemplateValidator } from '../TemplateValidator';

// ============================================================================
// Main component
// ============================================================================

export function ApprovalConfigPanel({
  node,
  upstreamNodes,
  onUpdate,
  onDelete,
  onClose,
  className = '',
}: NodeConfigPanelProps) {
  const data = node.data as ApprovalNodeData;

  const [label, setLabel] = useState(data.label ?? 'Approval Gate');
  const [description, setDescription] = useState(data.description ?? '');
  const [approvalMessage, setApprovalMessage] = useState(data.approvalMessage ?? '');
  const [timeoutMinutes, setTimeoutMinutes] = useState<number | undefined>(data.timeoutMinutes);

  const save = useCallback(
    (updates: Partial<ApprovalNodeData>) => {
      onUpdate(node.id, { ...data, ...updates });
    },
    [node.id, data, onUpdate]
  );

  const injectTemplate = useCallback(
    (template: string) => {
      const updated = approvalMessage + template;
      setApprovalMessage(updated);
      save({ approvalMessage: updated });
    },
    [approvalMessage, save]
  );

  return (
    <div
      className={`flex flex-col border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary overflow-y-auto ${className}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border dark:border-dark-border">
        <ShieldCheck className="w-4 h-4 text-amber-500" />
        <h3 className="text-xs font-semibold text-text-primary dark:text-dark-text-primary flex-1 truncate">
          Approval Gate
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

        {/* Approval Message */}
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-text-secondary dark:text-dark-text-secondary uppercase tracking-wide">
            Approval Message
          </label>
          <textarea
            value={approvalMessage}
            onChange={(e) => {
              setApprovalMessage(e.target.value);
              save({ approvalMessage: e.target.value });
            }}
            placeholder="Message shown to the approver..."
            rows={3}
            className="w-full px-2 py-1 text-xs bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary resize-none"
          />
          <p className="text-[10px] text-text-muted dark:text-dark-text-muted">
            {
              'This message will be shown when the workflow pauses for approval. Supports {{template}} expressions.'
            }
          </p>
          <TemplateValidator value={approvalMessage} upstreamNodes={upstreamNodes} />
        </div>

        {/* Timeout */}
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-text-secondary dark:text-dark-text-secondary uppercase tracking-wide">
            Timeout (minutes)
          </label>
          <input
            type="number"
            min={0}
            value={timeoutMinutes ?? ''}
            onChange={(e) => {
              const v = e.target.value ? parseInt(e.target.value, 10) : undefined;
              setTimeoutMinutes(v);
              save({ timeoutMinutes: v });
            }}
            placeholder="No timeout"
            className="w-full px-2 py-1 text-xs bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary"
          />
          <p className="text-[10px] text-text-muted dark:text-dark-text-muted">
            Auto-reject if not approved within this time. Leave empty for no timeout.
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
                {data.executionStatus === 'running'
                  ? 'AWAITING APPROVAL'
                  : (data.executionStatus as string).toUpperCase()}
              </span>
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

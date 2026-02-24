/**
 * Node Configuration Panel — right panel in the workflow editor.
 * Routes to the appropriate panel component based on node type.
 *
 * Also exports shared types, constants, and sub-components used
 * by the per-type panel implementations in ./panels/.
 */

import { Activity, CheckCircle2, XCircle, AlertCircle } from '../icons';
import type { NodeExecutionStatus } from '../../api/types';
import type { ToolNodeType } from './ToolNode';
import type { Node } from '@xyflow/react';

import {
  ToolConfigPanel,
  TriggerConfigPanel,
  LlmConfigPanel,
  ConditionConfigPanel,
  CodeConfigPanel,
  TransformerConfigPanel,
  ForEachConfigPanel,
} from './panels';

// ============================================================================
// Shared types
// ============================================================================

export interface NodeConfigPanelProps {
  node: ToolNodeType | Node;
  upstreamNodes: ToolNodeType[];
  onUpdate: (nodeId: string, data: Record<string, unknown>) => void;
  onDelete: (nodeId: string) => void;
  onClose: () => void;
  className?: string;
}

// ============================================================================
// Shared constants
// ============================================================================

export const statusBadgeStyles: Record<NodeExecutionStatus, string> = {
  pending: 'bg-text-muted/10 text-text-muted',
  running: 'bg-warning/10 text-warning',
  success: 'bg-success/10 text-success',
  error: 'bg-error/10 text-error',
  skipped: 'bg-text-muted/10 text-text-muted',
};

export const statusIcons: Partial<
  Record<NodeExecutionStatus, React.ComponentType<{ className?: string }>>
> = {
  running: Activity,
  success: CheckCircle2,
  error: XCircle,
  skipped: AlertCircle,
};

export const INPUT_CLS =
  'w-full px-3 py-1.5 text-sm bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary';

// ============================================================================
// Retry & Timeout constants
// ============================================================================

const RETRY_OPTIONS = [
  { value: 0, label: 'No retry' },
  { value: 1, label: '1x' },
  { value: 2, label: '2x' },
  { value: 3, label: '3x' },
  { value: 5, label: '5x' },
] as const;

const TIMEOUT_OPTIONS = [
  { value: 0, label: 'No limit' },
  { value: 5000, label: '5s' },
  { value: 10000, label: '10s' },
  { value: 30000, label: '30s' },
  { value: 60000, label: '1m' },
  { value: 120000, label: '2m' },
  { value: 300000, label: '5m' },
] as const;

// ============================================================================
// Shared sub-components
// ============================================================================

export function RetryTimeoutFields({
  data,
  nodeId,
  onUpdate,
}: {
  data: Record<string, unknown>;
  nodeId: string;
  onUpdate: (id: string, data: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-2 pt-3 border-t border-border dark:border-dark-border">
      <div className="text-[10px] font-medium text-text-muted dark:text-dark-text-muted uppercase tracking-wider">
        Error Handling
      </div>
      <div className="flex items-center justify-between">
        <label className="text-xs text-text-secondary dark:text-dark-text-secondary">
          Retry on failure
        </label>
        <select
          value={(data.retryCount as number) ?? 0}
          onChange={(e) =>
            onUpdate(nodeId, { ...data, retryCount: Number(e.target.value) || undefined })
          }
          className="px-2 py-1 text-xs bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {RETRY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between">
        <label className="text-xs text-text-secondary dark:text-dark-text-secondary">Timeout</label>
        <select
          value={(data.timeoutMs as number) ?? 0}
          onChange={(e) =>
            onUpdate(nodeId, { ...data, timeoutMs: Number(e.target.value) || undefined })
          }
          className="px-2 py-1 text-xs bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {TIMEOUT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function RetryAttemptsDisplay({
  retryAttempts,
  status,
}: {
  retryAttempts: number;
  status: string;
}) {
  const label =
    status === 'success'
      ? `Succeeded after ${retryAttempts} ${retryAttempts === 1 ? 'retry' : 'retries'}`
      : `Failed after ${retryAttempts} ${retryAttempts === 1 ? 'retry' : 'retries'}`;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full ${
        status === 'success' ? 'bg-warning/10 text-warning' : 'bg-error/10 text-error'
      }`}
    >
      {label}
    </span>
  );
}

// ============================================================================
// Router — main exported component
// ============================================================================

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
  if (props.node.type === 'forEachNode') {
    return <ForEachConfigPanel {...props} />;
  }
  return <ToolConfigPanel {...props} />;
}

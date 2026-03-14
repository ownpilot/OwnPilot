/**
 * Shared constants and helpers for the workflow editor components.
 */

import { MarkerType } from '@xyflow/react';
import {
  ToolNode,
  TriggerNode,
  LlmNode,
  ConditionNode,
  CodeNode,
  TransformerNode,
  ForEachNode,
  HttpRequestNode,
  DelayNode,
  SwitchNode,
  ErrorHandlerNode,
  SubWorkflowNode,
  ApprovalNode,
  StickyNoteNode,
  NotificationNode,
  ParallelNode,
  MergeNode,
  DataStoreNode,
  SchemaValidatorNode,
  FilterNode,
  MapNode,
  AggregateNode,
  WebhookResponseNode,
} from '../../components/workflows';

// Register custom node types
export const nodeTypes = {
  toolNode: ToolNode,
  triggerNode: TriggerNode,
  llmNode: LlmNode,
  conditionNode: ConditionNode,
  codeNode: CodeNode,
  transformerNode: TransformerNode,
  forEachNode: ForEachNode,
  httpRequestNode: HttpRequestNode,
  delayNode: DelayNode,
  switchNode: SwitchNode,
  errorHandlerNode: ErrorHandlerNode,
  subWorkflowNode: SubWorkflowNode,
  approvalNode: ApprovalNode,
  stickyNoteNode: StickyNoteNode,
  notificationNode: NotificationNode,
  parallelNode: ParallelNode,
  mergeNode: MergeNode,
  dataStoreNode: DataStoreNode,
  schemaValidatorNode: SchemaValidatorNode,
  filterNode: FilterNode,
  mapNode: MapNode,
  aggregateNode: AggregateNode,
  webhookResponseNode: WebhookResponseNode,
};

// Default edge options — arrow markers for flow direction
export const defaultEdgeOptions = {
  style: { stroke: 'var(--color-border)', strokeWidth: 2 },
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: 'var(--color-border)' },
};

/** Edge label + color config for named source handles */
export const HANDLE_EDGE_PROPS: Record<string, { label: string; style: Record<string, string> }> = {
  true: { label: 'True', style: { stroke: '#10b981' } }, // emerald
  false: { label: 'False', style: { stroke: '#ef4444' } }, // red
  each: { label: 'Each', style: { stroke: '#0ea5e9' } }, // sky
  done: { label: 'Done', style: { stroke: '#8b5cf6' } }, // violet
};

export const EDGE_LABEL_STYLE = {
  fontSize: 10,
  fontWeight: 600,
  fill: 'var(--color-text-muted)',
} as const;

export function getEdgeLabelProps(sourceHandle: string | null | undefined) {
  if (!sourceHandle) return {};
  const cfg = HANDLE_EDGE_PROPS[sourceHandle];
  if (cfg) {
    return {
      label: cfg.label,
      labelStyle: EDGE_LABEL_STYLE,
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 4,
      labelBgStyle: { fill: 'var(--color-bg-secondary)', opacity: 0.9 },
      style: { ...defaultEdgeOptions.style, ...cfg.style },
      markerEnd: { ...defaultEdgeOptions.markerEnd, color: cfg.style.stroke },
    };
  }
  // Fallback for dynamic handles (switch node cases, etc.)
  const switchColor = '#d946ef'; // fuchsia-500
  return {
    label: sourceHandle === 'default' ? 'Default' : sourceHandle,
    labelStyle: EDGE_LABEL_STYLE,
    labelBgPadding: [6, 3] as [number, number],
    labelBgBorderRadius: 4,
    labelBgStyle: { fill: 'var(--color-bg-secondary)', opacity: 0.9 },
    style: { ...defaultEdgeOptions.style, stroke: switchColor },
    markerEnd: { ...defaultEdgeOptions.markerEnd, color: switchColor },
  };
}

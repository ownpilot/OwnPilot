/**
 * WorkflowSourceModal — shows the workflow definition as formatted JSON.
 * Includes Copy and Download buttons. Read-only source view.
 */

import { useState, useCallback, useMemo } from 'react';
import { X, Copy, Check, Download } from '../icons';
import type { ToolNodeData } from './ToolNode';
import type { TriggerNodeData } from './TriggerNode';
import type { LlmNodeData } from './LlmNode';
import type { ConditionNodeData } from './ConditionNode';
import type { CodeNodeData } from './CodeNode';
import type { TransformerNodeData } from './TransformerNode';
import type { Edge, Node } from '@xyflow/react';

interface WorkflowSourceModalProps {
  workflowName: string;
  nodes: Node[];
  edges: Edge[];
  variables?: Record<string, unknown>;
  onClose: () => void;
}

/**
 * Build a clean, portable workflow definition object from ReactFlow state.
 * Strips runtime-only fields (executionStatus, etc.) and formats for readability.
 */
function buildWorkflowDefinition(
  name: string,
  nodes: Node[],
  edges: Edge[],
  variables?: Record<string, unknown>,
) {
  return {
    name,
    nodes: nodes.map((n) => {
      // Trigger node — show trigger config
      if (n.type === 'triggerNode') {
        const td = n.data as TriggerNodeData;
        const node: Record<string, unknown> = {
          id: n.id,
          type: 'trigger',
          triggerType: td.triggerType,
          label: td.label,
          position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        };
        if (td.cron) node.cron = td.cron;
        if (td.eventType) node.eventType = td.eventType;
        if (td.condition) node.condition = td.condition;
        if (td.threshold) node.threshold = td.threshold;
        if (td.webhookPath) node.webhookPath = td.webhookPath;
        if (td.triggerId) node.triggerId = td.triggerId;
        return node;
      }

      // LLM node — show provider/model config
      if (n.type === 'llmNode') {
        const ld = n.data as LlmNodeData;
        const node: Record<string, unknown> = {
          id: n.id,
          type: 'llm',
          label: ld.label,
          provider: ld.provider,
          model: ld.model,
          position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        };
        if (ld.systemPrompt) node.systemPrompt = ld.systemPrompt;
        if (ld.userMessage) node.userMessage = ld.userMessage;
        if (ld.temperature != null) node.temperature = ld.temperature;
        if (ld.maxTokens != null) node.maxTokens = ld.maxTokens;
        return node;
      }

      // Condition node
      if (n.type === 'conditionNode') {
        const cd = n.data as ConditionNodeData;
        const node: Record<string, unknown> = {
          id: n.id,
          type: 'condition',
          label: cd.label,
          expression: cd.expression,
          position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        };
        if (cd.description) node.description = cd.description;
        return node;
      }

      // Code node
      if (n.type === 'codeNode') {
        const cd = n.data as CodeNodeData;
        return {
          id: n.id,
          type: 'code',
          label: cd.label,
          language: cd.language,
          code: cd.code,
          ...(cd.description ? { description: cd.description } : {}),
          position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        };
      }

      // Transformer node
      if (n.type === 'transformerNode') {
        const td = n.data as TransformerNodeData;
        const node: Record<string, unknown> = {
          id: n.id,
          type: 'transformer',
          label: td.label,
          expression: td.expression,
          position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        };
        if (td.description) node.description = td.description;
        return node;
      }

      // Tool node — show tool config
      const d = n.data as ToolNodeData;
      const node: Record<string, unknown> = {
        id: n.id,
        tool: d.toolName,
        label: d.label,
        position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      };
      if (d.description) node.description = d.description;
      if (d.toolArgs && Object.keys(d.toolArgs).length > 0) node.args = d.toolArgs;
      return node;
    }),
    edges: edges.map((e) => {
      const edge: Record<string, string> = {
        source: e.source,
        target: e.target,
      };
      if (e.sourceHandle) edge.sourceHandle = e.sourceHandle;
      if (e.targetHandle) edge.targetHandle = e.targetHandle;
      return edge;
    }),
    ...(variables && Object.keys(variables).length > 0 ? { variables } : {}),
  };
}

export function WorkflowSourceModal({ workflowName, nodes, edges, variables, onClose }: WorkflowSourceModalProps) {
  const [copied, setCopied] = useState(false);

  const definition = useMemo(
    () => buildWorkflowDefinition(workflowName, nodes, edges, variables),
    [workflowName, nodes, edges, variables],
  );
  const json = useMemo(() => JSON.stringify(definition, null, 2), [definition]);

  const handleCopy = useCallback(() => {
    navigator.clipboard?.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [json]);

  const handleDownload = useCallback(() => {
    const slug = workflowName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'workflow';
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.workflow.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [json, workflowName]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="relative w-full max-w-3xl max-h-[85vh] mx-4 flex flex-col bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border dark:border-dark-border">
          <h2 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
            Workflow Source
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-text-secondary dark:text-dark-text-secondary hover:text-text-primary dark:hover:text-dark-text-primary bg-bg-tertiary dark:bg-dark-bg-tertiary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md transition-colors"
            >
              {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-text-secondary dark:text-dark-text-secondary hover:text-text-primary dark:hover:text-dark-text-primary bg-bg-tertiary dark:bg-dark-bg-tertiary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md transition-colors"
            >
              <Download className="w-3 h-3" />
              Download
            </button>
            <button
              onClick={onClose}
              className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* JSON content */}
        <div className="flex-1 overflow-auto p-4">
          <pre className="text-xs font-mono text-text-primary dark:text-dark-text-primary whitespace-pre leading-relaxed">
            {json}
          </pre>
        </div>

        {/* Footer stats */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-border dark:border-dark-border text-[10px] text-text-muted dark:text-dark-text-muted">
          <span>{nodes.length} node{nodes.length !== 1 ? 's' : ''}</span>
          <span>{edges.length} edge{edges.length !== 1 ? 's' : ''}</span>
          <span>{json.length.toLocaleString()} chars</span>
        </div>
      </div>
    </div>
  );
}

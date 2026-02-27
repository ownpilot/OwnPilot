/**
 * WorkflowSourceModal — shows the workflow definition as formatted JSON.
 * Includes Copy and Download buttons. Read-only source view.
 */

import { useState, useCallback, useMemo, useRef } from 'react';
import { X, Copy, Check, Download, Upload } from '../icons';
import type { ToolNodeData } from './ToolNode';
import type { TriggerNodeData } from './TriggerNode';
import type { LlmNodeData } from './LlmNode';
import type { ConditionNodeData } from './ConditionNode';
import type { CodeNodeData } from './CodeNode';
import type { TransformerNodeData } from './TransformerNode';
import type { ForEachNodeData } from './ForEachNode';
import type { HttpRequestNodeData } from './HttpRequestNode';
import type { DelayNodeData } from './DelayNode';
import type { SwitchNodeData } from './SwitchNode';
import type { Edge, Node } from '@xyflow/react';

interface WorkflowSourceModalProps {
  workflowName: string;
  nodes: Node[];
  edges: Edge[];
  variables?: Record<string, unknown>;
  onClose: () => void;
  /** When provided, shows an Import button that loads a .workflow.json file */
  onImport?: (json: Record<string, unknown>) => void;
}

/**
 * Build a clean, portable workflow definition object from ReactFlow state.
 * Strips runtime-only fields (executionStatus, etc.) and formats for readability.
 */
function buildWorkflowDefinition(
  name: string,
  nodes: Node[],
  edges: Edge[],
  variables?: Record<string, unknown>
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

      // ForEach node
      if (n.type === 'forEachNode') {
        const fd = n.data as ForEachNodeData;
        const node: Record<string, unknown> = {
          id: n.id,
          type: 'forEach',
          label: fd.label,
          arrayExpression: fd.arrayExpression,
          position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        };
        if (fd.itemVariable) node.itemVariable = fd.itemVariable;
        if (fd.maxIterations != null) node.maxIterations = fd.maxIterations;
        if (fd.onError) node.onError = fd.onError;
        if (fd.description) node.description = fd.description;
        return node;
      }

      // HTTP Request node
      if (n.type === 'httpRequestNode') {
        const hd = n.data as HttpRequestNodeData;
        const node: Record<string, unknown> = {
          id: n.id,
          type: 'httpRequest',
          label: hd.label,
          method: hd.method,
          url: hd.url,
          position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        };
        if (hd.headers && Object.keys(hd.headers).length > 0) node.headers = hd.headers;
        if (hd.queryParams && Object.keys(hd.queryParams).length > 0) node.queryParams = hd.queryParams;
        if (hd.body) node.body = hd.body;
        if (hd.bodyType) node.bodyType = hd.bodyType;
        if (hd.auth && hd.auth.type !== 'none') node.auth = hd.auth;
        if (hd.description) node.description = hd.description;
        return node;
      }

      // Delay node
      if (n.type === 'delayNode') {
        const dd = n.data as DelayNodeData;
        const node: Record<string, unknown> = {
          id: n.id,
          type: 'delay',
          label: dd.label,
          duration: dd.duration,
          unit: dd.unit,
          position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        };
        if (dd.description) node.description = dd.description;
        return node;
      }

      // Switch node
      if (n.type === 'switchNode') {
        const sd = n.data as SwitchNodeData;
        const node: Record<string, unknown> = {
          id: n.id,
          type: 'switch',
          label: sd.label,
          expression: sd.expression,
          cases: sd.cases,
          position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        };
        if (sd.description) node.description = sd.description;
        return node;
      }

      // Error handler node
      if (n.type === 'errorHandlerNode') {
        const eh = n.data as Record<string, unknown>;
        const node: Record<string, unknown> = {
          id: n.id,
          type: 'errorHandler',
          label: eh.label ?? 'Error Handler',
          position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        };
        if (eh.description) node.description = eh.description;
        if (eh.continueOnSuccess) node.continueOnSuccess = true;
        return node;
      }

      // Sub-workflow node
      if (n.type === 'subWorkflowNode') {
        const sw = n.data as Record<string, unknown>;
        const node: Record<string, unknown> = {
          id: n.id,
          type: 'subWorkflow',
          label: sw.label ?? 'Sub-Workflow',
          position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        };
        if (sw.subWorkflowId) node.subWorkflowId = sw.subWorkflowId;
        if (sw.subWorkflowName) node.subWorkflowName = sw.subWorkflowName;
        if (sw.inputMapping && Object.keys(sw.inputMapping as Record<string, unknown>).length > 0)
          node.inputMapping = sw.inputMapping;
        if (sw.maxDepth != null) node.maxDepth = sw.maxDepth;
        if (sw.description) node.description = sw.description;
        return node;
      }

      // Approval node
      if (n.type === 'approvalNode') {
        const ap = n.data as Record<string, unknown>;
        const node: Record<string, unknown> = {
          id: n.id,
          type: 'approval',
          label: ap.label ?? 'Approval Gate',
          position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        };
        if (ap.approvalMessage) node.approvalMessage = ap.approvalMessage;
        if (ap.timeoutMinutes != null) node.timeoutMinutes = ap.timeoutMinutes;
        if (ap.description) node.description = ap.description;
        return node;
      }

      // Sticky note node
      if (n.type === 'stickyNoteNode') {
        const sn = n.data as Record<string, unknown>;
        const node: Record<string, unknown> = {
          id: n.id,
          type: 'stickyNote',
          label: sn.label ?? 'Note',
          position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        };
        if (sn.text) node.text = sn.text;
        if (sn.color) node.color = sn.color;
        return node;
      }

      // Notification node
      if (n.type === 'notificationNode') {
        const nn = n.data as Record<string, unknown>;
        const node: Record<string, unknown> = {
          id: n.id,
          type: 'notification',
          label: nn.label ?? 'Notification',
          position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        };
        if (nn.message) node.message = nn.message;
        if (nn.severity) node.severity = nn.severity;
        if (nn.description) node.description = nn.description;
        return node;
      }

      // Parallel node
      if (n.type === 'parallelNode') {
        const pn = n.data as Record<string, unknown>;
        const node: Record<string, unknown> = {
          id: n.id,
          type: 'parallel',
          label: pn.label ?? 'Parallel',
          branchCount: pn.branchCount ?? 2,
          position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        };
        if (pn.branchLabels) node.branchLabels = pn.branchLabels;
        if (pn.description) node.description = pn.description;
        return node;
      }

      // Merge node
      if (n.type === 'mergeNode') {
        const mn = n.data as Record<string, unknown>;
        const node: Record<string, unknown> = {
          id: n.id,
          type: 'merge',
          label: mn.label ?? 'Merge',
          position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        };
        if (mn.mode) node.mode = mn.mode;
        if (mn.description) node.description = mn.description;
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
    }).map((node, i) => {
      // Append outputAlias to any node that has one
      const alias = (nodes[i]!.data as Record<string, unknown>).outputAlias as string | undefined;
      if (alias) return { ...node, outputAlias: alias };
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

export function WorkflowSourceModal({
  workflowName,
  nodes,
  edges,
  variables,
  onClose,
  onImport,
}: WorkflowSourceModalProps) {
  const [copied, setCopied] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const definition = useMemo(
    () => buildWorkflowDefinition(workflowName, nodes, edges, variables),
    [workflowName, nodes, edges, variables]
  );
  const json = useMemo(() => JSON.stringify(definition, null, 2), [definition]);

  const handleCopy = useCallback(() => {
    navigator.clipboard?.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [json]);

  const handleDownload = useCallback(() => {
    const slug =
      workflowName
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

  const handleImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setImportError(null);
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result as string);
          if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
            setImportError('Invalid workflow JSON: must contain "nodes" and "edges" arrays');
            return;
          }
          onImport?.(parsed);
          onClose();
        } catch {
          setImportError('Failed to parse JSON file');
        }
      };
      reader.readAsText(file);
      // Reset input so the same file can be re-selected
      e.target.value = '';
    },
    [onImport, onClose]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
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
            {onImport && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.workflow.json"
                  onChange={handleImport}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-text-secondary dark:text-dark-text-secondary hover:text-text-primary dark:hover:text-dark-text-primary bg-bg-tertiary dark:bg-dark-bg-tertiary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md transition-colors"
                >
                  <Upload className="w-3 h-3" />
                  Import
                </button>
              </>
            )}
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
          <span>
            {nodes.length} node{nodes.length !== 1 ? 's' : ''}
          </span>
          <span>
            {edges.length} edge{edges.length !== 1 ? 's' : ''}
          </span>
          <span>{json.length.toLocaleString()} chars</span>
          {importError && (
            <span className="ml-auto text-error">{importError}</span>
          )}
        </div>
      </div>
    </div>
  );
}

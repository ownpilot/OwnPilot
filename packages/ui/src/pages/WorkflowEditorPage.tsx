/**
 * Workflow Editor Page
 *
 * Three-panel layout:
 * +------------------+------------------------+-----------------+
 * | ToolPalette      | ReactFlow Canvas       | NodeConfigPanel |
 * | (240px, left)    | (flex-1, center)       | (320px, right)  |
 * +------------------+------------------------+-----------------+
 *
 * Top bar: Back, workflow name (editable), Save, Execute, status.
 * Execution: SSE streaming with real-time node coloring.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  addEdge,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { workflowsApi, triggersApi, apiClient } from '../api';
import type { Workflow, WorkflowProgressEvent } from '../api';
import { formatToolName } from '../utils/formatters';
import {
  ToolNode,
  ToolPalette,
  NodeConfigPanel,
  WorkflowSourceModal,
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
  NodeSearchPalette,
  WorkflowCopilotPanel,
  VariablesPanel,
  WorkflowVersionsPanel,
  InputParametersPanel,
  TemplateGallery,
  convertDefinitionToReactFlow,
  autoArrangeNodes,
  type ToolNodeData,
  type ToolNodeType,
  type TriggerNodeData,
  type LlmNodeData,
  type ConditionNodeData,
  type CodeNodeData,
  type TransformerNodeData,
  type ForEachNodeData,
  type HttpRequestNodeData,
  type DelayNodeData,
  type SwitchNodeData,
  type WorkflowDefinition,
} from '../components/workflows';
import {
  ChevronLeft,
  Save,
  Play,
  StopCircle,
  Code,
  Sparkles,
  LayoutDashboard,
  ListChecks,
  FlaskConical,
  History,
  Settings,
  Layout,
} from '../components/icons';
import { toolsApi } from '../api';
import { useToast } from '../components/ToastProvider';
import { LoadingSpinner } from '../components/LoadingSpinner';

// Register custom node types
const nodeTypes = {
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
};

// Default edge options — arrow markers for flow direction
const defaultEdgeOptions = {
  style: { stroke: 'var(--color-border)', strokeWidth: 2 },
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: 'var(--color-border)' },
};

// ============================================================================
// Main Component (wrapped in ReactFlowProvider for hook access)
// ============================================================================

export function WorkflowEditorPage() {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner />
    </ReactFlowProvider>
  );
}

function WorkflowEditorInner() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const toast = useToast();

  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isDryRun, setIsDryRun] = useState(false);
  const [workflowName, setWorkflowName] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [showCopilot, setShowCopilot] = useState(false);
  const [showVariables, setShowVariables] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [variables, setVariables] = useState<Record<string, unknown>>({});
  const [toolNames, setToolNames] = useState<string[]>([]);
  const [showNodeSearch, setShowNodeSearch] = useState(false);
  const [showInputParams, setShowInputParams] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [inputSchema, setInputSchema] = useState<Array<{ name: string; type: 'string' | 'number' | 'boolean' | 'json'; required: boolean; defaultValue?: string; description?: string }>>([]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const reactFlow = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();

  const abortRef = useRef<AbortController | null>(null);
  const nodeIdCounter = useRef(0);
  const clipboardRef = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);

  // ========================================================================
  // Undo/Redo history
  // ========================================================================

  const MAX_HISTORY = 50;
  const historyRef = useRef<Array<{ nodes: Node[]; edges: Edge[]; variables: Record<string, unknown> }>>([]);
  const historyIndexRef = useRef(-1);
  const skipHistoryRef = useRef(false);

  const pushHistory = useCallback(() => {
    if (skipHistoryRef.current) return;
    const snapshot = {
      nodes: nodes.map((n) => ({ ...n, data: { ...n.data } })),
      edges: edges.map((e) => ({ ...e })),
      variables: { ...variables },
    };
    // Truncate any future states (after undo)
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(snapshot);
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift();
    }
    historyIndexRef.current = historyRef.current.length - 1;
  }, [nodes, edges, variables]);

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const snapshot = historyRef.current[historyIndexRef.current]!;
    skipHistoryRef.current = true;
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    setVariables(snapshot.variables);
    setHasUnsavedChanges(true);
    skipHistoryRef.current = false;
  }, [setNodes, setEdges]);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const snapshot = historyRef.current[historyIndexRef.current]!;
    skipHistoryRef.current = true;
    setNodes(snapshot.nodes);
    setEdges(snapshot.edges);
    setVariables(snapshot.variables);
    setHasUnsavedChanges(true);
    skipHistoryRef.current = false;
  }, [setNodes, setEdges]);

  // ========================================================================
  // Load workflow
  // ========================================================================

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const wf = await workflowsApi.get(id);
        if (cancelled) return;
        setWorkflow(wf);
        setWorkflowName(wf.name);
        setVariables(wf.variables ?? {});
        setInputSchema(wf.inputSchema ?? []);

        // Convert stored nodes to ReactFlow nodes
        const rfNodes: Node[] = wf.nodes.map((n) => {
          if (
            n.type === 'triggerNode' ||
            n.type === 'llmNode' ||
            n.type === 'conditionNode' ||
            n.type === 'codeNode' ||
            n.type === 'transformerNode' ||
            n.type === 'forEachNode' ||
            n.type === 'httpRequestNode' ||
            n.type === 'delayNode' ||
            n.type === 'switchNode' ||
            n.type === 'errorHandlerNode' ||
            n.type === 'subWorkflowNode' ||
            n.type === 'approvalNode' ||
            n.type === 'stickyNoteNode' ||
            n.type === 'notificationNode' ||
            n.type === 'parallelNode' ||
            n.type === 'mergeNode'
          ) {
            return {
              id: n.id,
              type: n.type,
              position: n.position,
              data: n.data as unknown as Record<string, unknown>,
            };
          }
          const td = n.data as import('../api/types').WorkflowToolNodeData;
          return {
            id: n.id,
            type: 'toolNode',
            position: n.position,
            data: {
              toolName: td.toolName,
              toolArgs: td.toolArgs,
              label: td.label,
              description: td.description,
            },
          };
        });

        const rfEdges: Edge[] = wf.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle,
          ...getEdgeLabelProps(e.sourceHandle),
        }));

        setNodes(rfNodes);
        setEdges(rfEdges);

        // Track max node ID for new node generation
        const maxId = wf.nodes.reduce((max, n) => {
          const num = parseInt(n.id.replace('node_', ''), 10);
          return isNaN(num) ? max : Math.max(max, num);
        }, 0);
        nodeIdCounter.current = maxId;

        // Initialize undo/redo history
        historyRef.current = [{
          nodes: rfNodes.map((n) => ({ ...n, data: { ...n.data } })),
          edges: rfEdges.map((e) => ({ ...e })),
          variables: wf.variables ?? {},
        }];
        historyIndexRef.current = 0;
      } catch {
        toast.error('Failed to load workflow');
        navigate('/workflows');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Fetch available tool names for the copilot (only workflow-usable tools)
  useEffect(() => {
    toolsApi
      .list()
      .then((tools) =>
        setToolNames(tools.filter((t) => t.workflowUsable !== false).map((t) => t.name))
      )
      .catch(() => {});
  }, []);

  // Auto-execute if ?execute=true
  useEffect(() => {
    if (!isLoading && workflow && searchParams.get('execute') === 'true') {
      handleExecute(false);
    }
  }, [isLoading, workflow]);

  // ========================================================================
  // Canvas handlers
  // ========================================================================

  // Connection validation — prevent invalid edges
  const isValidConnection = useCallback(
    (connection: Edge | Connection) => {
      // No self-connections
      if (connection.source === connection.target) return false;
      // No duplicate edges
      const duplicate = edges.some(
        (e) =>
          e.source === connection.source &&
          e.target === connection.target &&
          e.sourceHandle === connection.sourceHandle &&
          e.targetHandle === connection.targetHandle
      );
      if (duplicate) return false;
      // Trigger node can only be source, never target
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (targetNode?.type === 'triggerNode') return false;
      // Sticky notes cannot be connected
      const sourceNode = nodes.find((n) => n.id === connection.source);
      if (sourceNode?.type === 'stickyNoteNode' || targetNode?.type === 'stickyNoteNode') return false;
      return true;
    },
    [edges, nodes]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      pushHistory();
      const edgeProps = getEdgeLabelProps(connection.sourceHandle);
      setEdges((eds) => addEdge({ ...connection, ...edgeProps }, eds));
      setHasUnsavedChanges(true);
    },
    [setEdges, pushHistory]
  );

  const onNodesChangeWrapped = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      // Push history only for meaningful changes (not every drag pixel)
      if (changes.some((c) => c.type === 'remove' || c.type === 'add')) {
        pushHistory();
      }
      onNodesChange(changes);
      if (changes.some((c) => c.type === 'position' || c.type === 'remove' || c.type === 'add')) {
        setHasUnsavedChanges(true);
      }
    },
    [onNodesChange, pushHistory]
  );

  const onEdgesChangeWrapped = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      if (changes.some((c) => c.type === 'remove' || c.type === 'add')) {
        pushHistory();
      }
      onEdgesChange(changes);
      if (changes.some((c) => c.type === 'remove' || c.type === 'add')) {
        setHasUnsavedChanges(true);
      }
    },
    [onEdgesChange, pushHistory]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const handleArrange = useCallback(() => {
    const arranged = autoArrangeNodes(nodes, edges);
    setNodes(arranged);
    setHasUnsavedChanges(true);
    requestAnimationFrame(() => {
      reactFlow.fitView({ padding: 0.15, duration: 300 });
    });
  }, [nodes, edges, setNodes, reactFlow]);

  // ========================================================================
  // Drop handler — create new node from palette drag
  // ========================================================================

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData('application/reactflow');
      if (!raw) return;

      let toolInfo: { toolName: string; toolDescription?: string };
      try {
        toolInfo = JSON.parse(raw);
      } catch {
        return;
      }

      const reactFlowBounds = (e.target as HTMLElement)
        .closest('.react-flow')
        ?.getBoundingClientRect();
      if (!reactFlowBounds) return;

      const position = {
        x: e.clientX - reactFlowBounds.left,
        y: e.clientY - reactFlowBounds.top,
      };

      nodeIdCounter.current += 1;
      const newNodeId = `node_${nodeIdCounter.current}`;

      const newNode: Node = {
        id: newNodeId,
        type: 'toolNode',
        position,
        data: {
          toolName: toolInfo.toolName,
          toolArgs: {},
          label: formatToolName(toolInfo.toolName),
          description: toolInfo.toolDescription,
        },
      };

      setNodes((nds) => [...nds, newNode]);
      setSelectedNodeId(newNodeId);
      setHasUnsavedChanges(true);
    },
    [setNodes]
  );

  // ========================================================================
  // Node CRUD
  // ========================================================================

  const updateNodeData = useCallback(
    (nodeId: string, data: Record<string, unknown>) => {
      pushHistory();
      let needsHandleUpdate = false;

      setNodes((nds) => {
        const target = nds.find((n) => n.id === nodeId);

        // Switch node: reconcile edges when cases change
        if (target?.type === 'switchNode' && Array.isArray(data.cases)) {
          const oldCases = (target.data.cases ?? []) as Array<{ label: string }>;
          const newCases = data.cases as Array<{ label: string }>;

          // Detect if handle count or labels changed — triggers updateNodeInternals
          if (
            oldCases.length !== newCases.length ||
            oldCases.some((c, i) => c.label !== newCases[i]?.label)
          ) {
            needsHandleUpdate = true;
          }

          // Build old→new label mapping for renames
          const labelMap = new Map<string, string>();
          const newLabels = new Set(newCases.map((c) => c.label));
          newLabels.add('default'); // default handle is always valid

          for (let i = 0; i < Math.min(oldCases.length, newCases.length); i++) {
            if (oldCases[i]!.label !== newCases[i]!.label) {
              labelMap.set(oldCases[i]!.label, newCases[i]!.label);
            }
          }

          setEdges((eds) =>
            eds
              .map((e) => {
                if (e.source !== nodeId || !e.sourceHandle) return e;
                // Rename handle if label changed
                const renamed = labelMap.get(e.sourceHandle);
                if (renamed) return { ...e, sourceHandle: renamed };
                return e;
              })
              // Remove edges pointing to deleted case handles
              .filter((e) => {
                if (e.source !== nodeId || !e.sourceHandle) return true;
                return newLabels.has(e.sourceHandle);
              })
          );
        }

        return nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n));
      });

      // Force ReactFlow to re-detect handle positions after DOM update
      if (needsHandleUpdate) {
        requestAnimationFrame(() => updateNodeInternals(nodeId));
      }

      setHasUnsavedChanges(true);
    },
    [setNodes, setEdges, updateNodeInternals, pushHistory]
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      pushHistory();
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedNodeId(null);
      setHasUnsavedChanges(true);
    },
    [setNodes, setEdges, pushHistory]
  );

  // ========================================================================
  // Save
  // ========================================================================

  const handleSave = useCallback(async () => {
    if (!id || !workflow) return;
    setIsSaving(true);
    try {
      // Helper: extract optional outputAlias from any node data
      const getAlias = (d: Record<string, unknown>) =>
        d.outputAlias && typeof d.outputAlias === 'string'
          ? { outputAlias: d.outputAlias }
          : {};

      const wfNodes = nodes.map((n) => {
        if (n.type === 'triggerNode') {
          const td = n.data as unknown as TriggerNodeData;
          return {
            id: n.id,
            type: 'triggerNode',
            position: n.position,
            data: {
              triggerType: td.triggerType,
              label: td.label,
              ...(td.cron ? { cron: td.cron } : {}),
              ...(td.timezone ? { timezone: td.timezone } : {}),
              ...(td.eventType ? { eventType: td.eventType } : {}),
              ...(td.filters ? { filters: td.filters } : {}),
              ...(td.condition ? { condition: td.condition } : {}),
              ...(td.threshold != null ? { threshold: td.threshold } : {}),
              ...(td.checkInterval != null ? { checkInterval: td.checkInterval } : {}),
              ...(td.webhookPath ? { webhookPath: td.webhookPath } : {}),
              ...(td.webhookSecret ? { webhookSecret: td.webhookSecret } : {}),
              ...(td.triggerId ? { triggerId: td.triggerId } : {}),
            },
          };
        }
        if (n.type === 'llmNode') {
          const ld = n.data as unknown as LlmNodeData;
          return {
            id: n.id,
            type: 'llmNode',
            position: n.position,
            data: {
              label: ld.label,
              provider: ld.provider,
              model: ld.model,
              systemPrompt: ld.systemPrompt,
              userMessage: ld.userMessage,
              temperature: ld.temperature,
              maxTokens: ld.maxTokens,
              ...(ld.apiKey ? { apiKey: ld.apiKey } : {}),
              ...(ld.baseUrl ? { baseUrl: ld.baseUrl } : {}),
              ...(ld.retryCount != null ? { retryCount: ld.retryCount } : {}),
              ...(ld.timeoutMs != null ? { timeoutMs: ld.timeoutMs } : {}),
              ...getAlias(n.data as unknown as Record<string, unknown>),
            },
          };
        }
        if (n.type === 'conditionNode') {
          const cd = n.data as unknown as ConditionNodeData;
          return {
            id: n.id,
            type: 'conditionNode',
            position: n.position,
            data: {
              label: cd.label,
              expression: cd.expression,
              description: cd.description,
              ...(cd.retryCount != null ? { retryCount: cd.retryCount } : {}),
              ...(cd.timeoutMs != null ? { timeoutMs: cd.timeoutMs } : {}),
              ...getAlias(n.data as unknown as Record<string, unknown>),
            },
          };
        }
        if (n.type === 'codeNode') {
          const cd = n.data as unknown as CodeNodeData;
          return {
            id: n.id,
            type: 'codeNode',
            position: n.position,
            data: {
              label: cd.label,
              language: cd.language,
              code: cd.code,
              description: cd.description,
              ...(cd.retryCount != null ? { retryCount: cd.retryCount } : {}),
              ...(cd.timeoutMs != null ? { timeoutMs: cd.timeoutMs } : {}),
              ...getAlias(n.data as unknown as Record<string, unknown>),
            },
          };
        }
        if (n.type === 'transformerNode') {
          const td = n.data as unknown as TransformerNodeData;
          return {
            id: n.id,
            type: 'transformerNode',
            position: n.position,
            data: {
              label: td.label,
              expression: td.expression,
              description: td.description,
              ...(td.retryCount != null ? { retryCount: td.retryCount } : {}),
              ...(td.timeoutMs != null ? { timeoutMs: td.timeoutMs } : {}),
              ...getAlias(n.data as unknown as Record<string, unknown>),
            },
          };
        }
        if (n.type === 'forEachNode') {
          const fd = n.data as unknown as ForEachNodeData;
          return {
            id: n.id,
            type: 'forEachNode',
            position: n.position,
            data: {
              label: fd.label,
              arrayExpression: fd.arrayExpression,
              ...(fd.itemVariable ? { itemVariable: fd.itemVariable } : {}),
              ...(fd.maxIterations != null ? { maxIterations: fd.maxIterations } : {}),
              ...(fd.onError ? { onError: fd.onError } : {}),
              ...(fd.description ? { description: fd.description } : {}),
              ...(fd.retryCount != null ? { retryCount: fd.retryCount } : {}),
              ...(fd.timeoutMs != null ? { timeoutMs: fd.timeoutMs } : {}),
              ...getAlias(n.data as unknown as Record<string, unknown>),
            },
          };
        }
        if (n.type === 'httpRequestNode') {
          const hd = n.data as unknown as HttpRequestNodeData;
          return {
            id: n.id,
            type: 'httpRequestNode',
            position: n.position,
            data: {
              label: hd.label,
              method: hd.method,
              url: hd.url,
              ...(hd.headers && Object.keys(hd.headers).length > 0 ? { headers: hd.headers } : {}),
              ...(hd.queryParams && Object.keys(hd.queryParams).length > 0 ? { queryParams: hd.queryParams } : {}),
              ...(hd.body ? { body: hd.body } : {}),
              ...(hd.bodyType ? { bodyType: hd.bodyType } : {}),
              ...(hd.auth && hd.auth.type !== 'none' ? { auth: hd.auth } : {}),
              ...(hd.maxResponseSize != null ? { maxResponseSize: hd.maxResponseSize } : {}),
              ...(hd.description ? { description: hd.description } : {}),
              ...(hd.retryCount != null ? { retryCount: hd.retryCount } : {}),
              ...(hd.timeoutMs != null ? { timeoutMs: hd.timeoutMs } : {}),
              ...getAlias(n.data as unknown as Record<string, unknown>),
            },
          };
        }
        if (n.type === 'delayNode') {
          const dd = n.data as unknown as DelayNodeData;
          return {
            id: n.id,
            type: 'delayNode',
            position: n.position,
            data: {
              label: dd.label,
              duration: dd.duration,
              unit: dd.unit,
              ...(dd.description ? { description: dd.description } : {}),
              ...getAlias(n.data as unknown as Record<string, unknown>),
            },
          };
        }
        if (n.type === 'switchNode') {
          const sd = n.data as unknown as SwitchNodeData;
          return {
            id: n.id,
            type: 'switchNode',
            position: n.position,
            data: {
              label: sd.label,
              expression: sd.expression,
              cases: sd.cases,
              ...(sd.description ? { description: sd.description } : {}),
              ...(sd.retryCount != null ? { retryCount: sd.retryCount } : {}),
              ...(sd.timeoutMs != null ? { timeoutMs: sd.timeoutMs } : {}),
              ...getAlias(n.data as unknown as Record<string, unknown>),
            },
          };
        }
        if (n.type === 'errorHandlerNode') {
          const eh = n.data as unknown as Record<string, unknown>;
          return {
            id: n.id,
            type: 'errorHandlerNode',
            position: n.position,
            data: {
              label: eh.label ?? 'Error Handler',
              ...(eh.description ? { description: eh.description } : {}),
              ...(eh.continueOnSuccess ? { continueOnSuccess: true } : {}),
              ...getAlias(eh),
            },
          };
        }
        if (n.type === 'subWorkflowNode') {
          const sw = n.data as unknown as Record<string, unknown>;
          return {
            id: n.id,
            type: 'subWorkflowNode',
            position: n.position,
            data: {
              label: sw.label ?? 'Sub-Workflow',
              ...(sw.description ? { description: sw.description } : {}),
              ...(sw.subWorkflowId ? { subWorkflowId: sw.subWorkflowId } : {}),
              ...(sw.subWorkflowName ? { subWorkflowName: sw.subWorkflowName } : {}),
              ...(sw.inputMapping && Object.keys(sw.inputMapping as Record<string, unknown>).length > 0
                ? { inputMapping: sw.inputMapping }
                : {}),
              ...(sw.maxDepth != null ? { maxDepth: sw.maxDepth } : {}),
              ...(sw.retryCount != null ? { retryCount: sw.retryCount } : {}),
              ...(sw.timeoutMs != null ? { timeoutMs: sw.timeoutMs } : {}),
              ...getAlias(sw),
            },
          };
        }
        if (n.type === 'approvalNode') {
          const ap = n.data as unknown as Record<string, unknown>;
          return {
            id: n.id,
            type: 'approvalNode',
            position: n.position,
            data: {
              label: ap.label ?? 'Approval Gate',
              ...(ap.description ? { description: ap.description } : {}),
              ...(ap.approvalMessage ? { approvalMessage: ap.approvalMessage } : {}),
              ...(ap.timeoutMinutes != null ? { timeoutMinutes: ap.timeoutMinutes } : {}),
              ...getAlias(ap),
            },
          };
        }
        if (n.type === 'stickyNoteNode') {
          const sn = n.data as unknown as Record<string, unknown>;
          return {
            id: n.id,
            type: 'stickyNoteNode',
            position: n.position,
            data: {
              label: sn.label ?? 'Note',
              ...(sn.text ? { text: sn.text } : {}),
              ...(sn.color ? { color: sn.color } : {}),
            },
          };
        }
        if (n.type === 'notificationNode') {
          const nn = n.data as unknown as Record<string, unknown>;
          return {
            id: n.id,
            type: 'notificationNode',
            position: n.position,
            data: {
              label: nn.label ?? 'Notification',
              ...(nn.message ? { message: nn.message } : {}),
              ...(nn.severity ? { severity: nn.severity } : {}),
              ...(nn.description ? { description: nn.description } : {}),
              ...(nn.retryCount != null ? { retryCount: nn.retryCount } : {}),
              ...(nn.timeoutMs != null ? { timeoutMs: nn.timeoutMs } : {}),
              ...getAlias(nn),
            },
          };
        }
        if (n.type === 'parallelNode') {
          const pn = n.data as unknown as Record<string, unknown>;
          return {
            id: n.id,
            type: 'parallelNode',
            position: n.position,
            data: {
              label: pn.label ?? 'Parallel',
              ...(pn.branchCount != null ? { branchCount: pn.branchCount } : {}),
              ...(pn.branchLabels ? { branchLabels: pn.branchLabels } : {}),
              ...(pn.description ? { description: pn.description } : {}),
              ...getAlias(pn),
            },
          };
        }
        if (n.type === 'mergeNode') {
          const mn = n.data as unknown as Record<string, unknown>;
          return {
            id: n.id,
            type: 'mergeNode',
            position: n.position,
            data: {
              label: mn.label ?? 'Merge',
              ...(mn.mode ? { mode: mn.mode } : {}),
              ...(mn.description ? { description: mn.description } : {}),
              ...getAlias(mn),
            },
          };
        }
        const toolData = n.data as ToolNodeData;
        return {
          id: n.id,
          type: n.type || 'toolNode',
          position: n.position,
          data: {
            toolName: toolData.toolName,
            toolArgs: toolData.toolArgs,
            label: toolData.label,
            description: toolData.description,
            ...(toolData.retryCount != null ? { retryCount: toolData.retryCount } : {}),
            ...(toolData.timeoutMs != null ? { timeoutMs: toolData.timeoutMs } : {}),
            ...getAlias(n.data as unknown as Record<string, unknown>),
          },
        };
      });

      const wfEdges = edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
      }));

      await workflowsApi.update(id, {
        name: workflowName,
        nodes: wfNodes,
        edges: wfEdges,
        variables,
        inputSchema,
      });

      // Sync trigger node with trigger system
      const triggerNode = nodes.find((n) => n.type === 'triggerNode');
      if (triggerNode) {
        const td = triggerNode.data as unknown as TriggerNodeData;
        if (td.triggerType !== 'manual') {
          await syncTrigger(id, workflowName, td, triggerNode.id);
        } else if (td.triggerId) {
          // Manual mode — delete linked trigger
          try {
            await triggersApi.delete(td.triggerId);
          } catch {
            /* may not exist */
          }
          updateNodeData(triggerNode.id, { triggerId: undefined });
        }
      } else {
        // Trigger node removed — clean up linked trigger if it existed
        const oldTrigger = workflow.nodes.find((n) => n.type === 'triggerNode');
        const oldTriggerId = (oldTrigger?.data as unknown as Record<string, unknown>)?.triggerId as
          | string
          | undefined;
        if (oldTriggerId) {
          try {
            await triggersApi.delete(oldTriggerId);
          } catch {
            /* ignore */
          }
        }
      }

      setHasUnsavedChanges(false);
      toast.success('Workflow saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  }, [id, workflow, nodes, edges, workflowName, toast, updateNodeData]);

  // ========================================================================
  // Execute — SSE stream with real-time node coloring
  // ========================================================================

  const handleExecute = useCallback(async (dryRun = false) => {
    if (!id || isExecuting) return;

    if (hasUnsavedChanges) {
      await handleSave();
    }

    setIsExecuting(true);
    setIsDryRun(dryRun);

    // Reset all node statuses
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: {
          ...n.data,
          executionStatus: 'pending',
          executionError: undefined,
          executionDuration: undefined,
          executionOutput: undefined,
          resolvedArgs: undefined,
          branchTaken: undefined,
          currentIteration: undefined,
          totalIterations: undefined,
        },
      }))
    );

    // Animate edges during execution
    setEdges((eds) => eds.map((e) => ({ ...e, animated: true })));

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const response = await workflowsApi.execute(id, { dryRun });
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No stream available');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const dataStr = line.slice(5).trim();
          if (!dataStr) continue;

          let event: WorkflowProgressEvent;
          try {
            event = JSON.parse(dataStr);
          } catch {
            continue;
          }

          handleProgressEvent(event);
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        toast.error(err instanceof Error ? err.message : 'Execution failed');
      }
    } finally {
      setIsExecuting(false);
      setIsDryRun(false);
      abortRef.current = null;
      setEdges((eds) => eds.map((e) => ({ ...e, animated: false })));
    }
  }, [id, isExecuting, hasUnsavedChanges, handleSave, toast, setNodes, setEdges]);

  const handleProgressEvent = useCallback(
    (event: WorkflowProgressEvent) => {
      switch (event.type) {
        case 'node_start':
          setNodes((nds) =>
            nds.map((n) =>
              n.id === event.nodeId ? { ...n, data: { ...n.data, executionStatus: 'running' } } : n
            )
          );
          break;

        case 'node_complete':
          setNodes((nds) =>
            nds.map((n) =>
              n.id === event.nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      executionStatus: event.status ?? 'success',
                      executionDuration: event.durationMs,
                      executionOutput: event.output,
                      resolvedArgs: event.resolvedArgs,
                      branchTaken: event.branchTaken,
                    },
                  }
                : n
            )
          );
          break;

        case 'node_error':
          setNodes((nds) =>
            nds.map((n) =>
              n.id === event.nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      executionStatus: 'error',
                      executionError: event.error,
                    },
                  }
                : n
            )
          );
          break;

        case 'node_retry':
          setNodes((nds) =>
            nds.map((n) =>
              n.id === event.nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      executionStatus: 'running',
                      retryAttempt: event.retryAttempt,
                    },
                  }
                : n
            )
          );
          break;

        case 'foreach_iteration_start':
        case 'foreach_iteration_complete':
          setNodes((nds) =>
            nds.map((n) =>
              n.id === event.nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      currentIteration: event.iterationIndex,
                      totalIterations: event.iterationTotal,
                    },
                  }
                : n
            )
          );
          break;

        case 'done':
          toast.success(
            event.logStatus === 'completed'
              ? `Workflow completed in ${event.durationMs ? `${(event.durationMs / 1000).toFixed(1)}s` : 'N/A'}`
              : `Workflow ${event.logStatus ?? 'finished'}`
          );
          break;

        case 'error':
          toast.error(event.error ?? 'Execution error');
          break;
      }
    },
    [setNodes, toast]
  );

  const handleCancel = useCallback(async () => {
    if (!id) return;
    abortRef.current?.abort();
    try {
      await workflowsApi.cancel(id);
      toast.success('Execution cancelled');
    } catch {
      // May already be finished
    }
  }, [id, toast]);

  // ========================================================================
  // Variables
  // ========================================================================

  const handleVariablesChange = useCallback(
    (newVars: Record<string, unknown>) => {
      pushHistory();
      setVariables(newVars);
      setHasUnsavedChanges(true);
    },
    [pushHistory]
  );

  // ========================================================================
  // Import workflow from JSON file
  // ========================================================================

  const handleImportWorkflow = useCallback(
    (json: Record<string, unknown>) => {
      if (nodes.length > 0 && !confirm('This will replace all current nodes and edges. Continue?'))
        return;

      const def = json as unknown as WorkflowDefinition;
      const { nodes: rfNodes, edges: rfEdges } = convertDefinitionToReactFlow(def, toolNames);

      const styledEdges = rfEdges.map((e) => ({
        ...e,
        ...getEdgeLabelProps(e.sourceHandle),
      }));

      const maxId = rfNodes.reduce((max, n) => {
        const num = parseInt(n.id.replace('node_', ''), 10);
        return isNaN(num) ? max : Math.max(max, num);
      }, 0);
      nodeIdCounter.current = maxId;

      setNodes(rfNodes);
      setEdges(styledEdges);
      if (def.name) setWorkflowName(def.name);
      if ((json as Record<string, unknown>).variables) {
        setVariables((json as Record<string, unknown>).variables as Record<string, unknown>);
      }
      setHasUnsavedChanges(true);
      setSelectedNodeId(null);
      toast.success('Workflow imported from file');
    },
    [nodes, toolNames, setNodes, setEdges, toast]
  );

  // ========================================================================
  // Keyboard shortcuts
  // ========================================================================

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip if user is typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement).isContentEditable) return;

      const ctrl = e.ctrlKey || e.metaKey;

      // Ctrl+S — Save
      if (ctrl && e.key === 's') {
        e.preventDefault();
        if (hasUnsavedChanges && !isSaving) handleSave();
        return;
      }

      // Ctrl+Z — Undo
      if (ctrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Ctrl+Shift+Z — Redo
      if (ctrl && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        redo();
        return;
      }

      // Ctrl+Y — Redo (alternative)
      if (ctrl && e.key === 'y') {
        e.preventDefault();
        redo();
        return;
      }

      // Delete / Backspace — Delete selected node
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) {
        e.preventDefault();
        deleteNode(selectedNodeId);
        return;
      }

      // Escape — Deselect / close panels
      if (e.key === 'Escape') {
        if (showNodeSearch) {
          setShowNodeSearch(false);
        } else if (selectedNodeId) {
          setSelectedNodeId(null);
        } else if (showCopilot) {
          setShowCopilot(false);
        } else if (showVariables) {
          setShowVariables(false);
        } else if (showVersions) {
          setShowVersions(false);
        }
        return;
      }

      // Ctrl+D — Duplicate selected node
      if (ctrl && e.key === 'd' && selectedNodeId) {
        e.preventDefault();
        const node = nodes.find((n) => n.id === selectedNodeId);
        if (!node) return;

        nodeIdCounter.current += 1;
        const newId = `node_${nodeIdCounter.current}`;
        const newNode: Node = {
          id: newId,
          type: node.type,
          position: { x: node.position.x + 32, y: node.position.y + 32 },
          data: { ...node.data },
        };
        setNodes((nds) => [...nds, newNode]);
        setSelectedNodeId(newId);
        setHasUnsavedChanges(true);
        return;
      }

      // Ctrl+C — Copy selected nodes
      if (ctrl && e.key === 'c') {
        const selected = nodes.filter((n) => n.selected);
        if (selected.length === 0) return;
        e.preventDefault();
        const selectedIds = new Set(selected.map((n) => n.id));
        const internalEdges = edges.filter(
          (ed) => selectedIds.has(ed.source) && selectedIds.has(ed.target)
        );
        // Store with relative positions (to center of selection)
        const avgX = selected.reduce((s, n) => s + n.position.x, 0) / selected.length;
        const avgY = selected.reduce((s, n) => s + n.position.y, 0) / selected.length;
        clipboardRef.current = {
          nodes: selected.map((n) => ({
            ...n,
            data: { ...n.data },
            position: { x: n.position.x - avgX, y: n.position.y - avgY },
          })),
          edges: internalEdges.map((ed) => ({ ...ed })),
        };
        return;
      }

      // Ctrl+V — Paste copied nodes
      if (ctrl && e.key === 'v' && clipboardRef.current) {
        e.preventDefault();
        const clip = clipboardRef.current;
        const idMap = new Map<string, string>();
        const newNodes: Node[] = [];

        // Generate new IDs and offset positions
        for (const n of clip.nodes) {
          nodeIdCounter.current += 1;
          const newId = `node_${nodeIdCounter.current}`;
          idMap.set(n.id, newId);
          newNodes.push({
            ...n,
            id: newId,
            selected: true,
            position: { x: n.position.x + 400 + 50, y: n.position.y + 300 + 50 },
            data: { ...n.data },
          });
        }

        const newEdges: Edge[] = clip.edges.map((ed) => ({
          ...ed,
          id: `e_${idMap.get(ed.source) ?? ed.source}_${idMap.get(ed.target) ?? ed.target}`,
          source: idMap.get(ed.source) ?? ed.source,
          target: idMap.get(ed.target) ?? ed.target,
        }));

        pushHistory();
        // Deselect existing nodes
        setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), ...newNodes]);
        setEdges((eds) => [...eds, ...newEdges]);
        setHasUnsavedChanges(true);
        return;
      }

      // Ctrl+X — Cut selected nodes
      if (ctrl && e.key === 'x') {
        const selected = nodes.filter((n) => n.selected);
        if (selected.length === 0) return;
        e.preventDefault();
        const selectedIds = new Set(selected.map((n) => n.id));
        const internalEdges = edges.filter(
          (ed) => selectedIds.has(ed.source) && selectedIds.has(ed.target)
        );
        const avgX = selected.reduce((s, n) => s + n.position.x, 0) / selected.length;
        const avgY = selected.reduce((s, n) => s + n.position.y, 0) / selected.length;
        clipboardRef.current = {
          nodes: selected.map((n) => ({
            ...n,
            data: { ...n.data },
            position: { x: n.position.x - avgX, y: n.position.y - avgY },
          })),
          edges: internalEdges.map((ed) => ({ ...ed })),
        };
        // Delete cut nodes
        pushHistory();
        setNodes((nds) => nds.filter((n) => !selectedIds.has(n.id)));
        setEdges((eds) => eds.filter((ed) => !selectedIds.has(ed.source) && !selectedIds.has(ed.target)));
        setSelectedNodeId(null);
        setHasUnsavedChanges(true);
        return;
      }

      // Ctrl+K or "/" — Open node search palette
      if ((ctrl && e.key === 'k') || (e.key === '/' && !ctrl)) {
        e.preventDefault();
        setShowNodeSearch(true);
        return;
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [
    hasUnsavedChanges,
    isSaving,
    handleSave,
    selectedNodeId,
    deleteNode,
    showCopilot,
    showVariables,
    showVersions,
    showNodeSearch,
    nodes,
    edges,
    setNodes,
    setEdges,
    undo,
    redo,
    pushHistory,
  ]);

  // ========================================================================
  // Trigger node helpers
  // ========================================================================

  const hasTriggerNode = useMemo(() => nodes.some((n) => n.type === 'triggerNode'), [nodes]);

  const addTriggerNode = useCallback(() => {
    if (hasTriggerNode) {
      toast.warning('Only one trigger node per workflow');
      return;
    }
    nodeIdCounter.current += 1;
    const newId = `node_${nodeIdCounter.current}`;
    const newNode: Node = {
      id: newId,
      type: 'triggerNode',
      position: { x: 300, y: 50 },
      data: { triggerType: 'manual', label: 'Trigger' },
    };
    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newId);
    setHasUnsavedChanges(true);
  }, [hasTriggerNode, setNodes, toast]);

  /** Add a tool node from the palette "+" button (auto-positioned) */
  const addToolNode = useCallback(
    (toolName: string, toolDescription?: string) => {
      nodeIdCounter.current += 1;
      const newNodeId = `node_${nodeIdCounter.current}`;

      // Position: offset below the bottommost node, or default center
      let y = 200;
      let x = 400;
      if (nodes.length > 0) {
        const maxY = Math.max(...nodes.map((n) => n.position.y));
        y = maxY + 120;
        // Align to the average x of existing nodes
        const avgX = nodes.reduce((sum, n) => sum + n.position.x, 0) / nodes.length;
        x = Math.round(avgX / 16) * 16; // snap to grid
      }

      const newNode: Node = {
        id: newNodeId,
        type: 'toolNode',
        position: { x, y },
        data: {
          toolName,
          toolArgs: {},
          label: formatToolName(toolName),
          description: toolDescription,
        },
      };

      setNodes((nds) => [...nds, newNode]);
      setSelectedNodeId(newNodeId);
      setHasUnsavedChanges(true);
    },
    [nodes, setNodes]
  );

  /** Add an LLM node from the toolbar button (auto-positioned) */
  const addLlmNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;

    let y = 200;
    let x = 400;
    if (nodes.length > 0) {
      const maxY = Math.max(...nodes.map((n) => n.position.y));
      y = maxY + 120;
      const avgX = nodes.reduce((sum, n) => sum + n.position.x, 0) / nodes.length;
      x = Math.round(avgX / 16) * 16;
    }

    const newNode: Node = {
      id: newNodeId,
      type: 'llmNode',
      position: { x, y },
      data: {
        label: 'LLM',
        provider: '',
        model: '',
        userMessage: '',
        temperature: 0.7,
        maxTokens: 4096,
      },
    };

    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes]);

  /** Add a Condition (if/else) node from the toolbar button */
  const addConditionNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;

    let y = 200;
    let x = 400;
    if (nodes.length > 0) {
      const maxY = Math.max(...nodes.map((n) => n.position.y));
      y = maxY + 120;
      const avgX = nodes.reduce((sum, n) => sum + n.position.x, 0) / nodes.length;
      x = Math.round(avgX / 16) * 16;
    }

    const newNode: Node = {
      id: newNodeId,
      type: 'conditionNode',
      position: { x, y },
      data: { label: 'Condition', expression: '' },
    };

    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes]);

  /** Add a Code execution node from the toolbar button */
  const addCodeNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;

    let y = 200;
    let x = 400;
    if (nodes.length > 0) {
      const maxY = Math.max(...nodes.map((n) => n.position.y));
      y = maxY + 120;
      const avgX = nodes.reduce((sum, n) => sum + n.position.x, 0) / nodes.length;
      x = Math.round(avgX / 16) * 16;
    }

    const newNode: Node = {
      id: newNodeId,
      type: 'codeNode',
      position: { x, y },
      data: { label: 'Code', language: 'javascript', code: '' },
    };

    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes]);

  /** Add a Transformer node from the toolbar button */
  const addTransformerNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;

    let y = 200;
    let x = 400;
    if (nodes.length > 0) {
      const maxY = Math.max(...nodes.map((n) => n.position.y));
      y = maxY + 120;
      const avgX = nodes.reduce((sum, n) => sum + n.position.x, 0) / nodes.length;
      x = Math.round(avgX / 16) * 16;
    }

    const newNode: Node = {
      id: newNodeId,
      type: 'transformerNode',
      position: { x, y },
      data: { label: 'Transform', expression: '' },
    };

    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes]);

  /** Add a ForEach (loop) node from the toolbar button */
  const addForEachNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;

    let y = 200;
    let x = 400;
    if (nodes.length > 0) {
      const maxY = Math.max(...nodes.map((n) => n.position.y));
      y = maxY + 120;
      const avgX = nodes.reduce((sum, n) => sum + n.position.x, 0) / nodes.length;
      x = Math.round(avgX / 16) * 16;
    }

    const newNode: Node = {
      id: newNodeId,
      type: 'forEachNode',
      position: { x, y },
      data: { label: 'ForEach', arrayExpression: '', maxIterations: 100, onError: 'stop' },
    };

    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes]);

  /** Add an HTTP Request node from the toolbar button */
  const addHttpRequestNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;

    let y = 200;
    let x = 400;
    if (nodes.length > 0) {
      const maxY = Math.max(...nodes.map((n) => n.position.y));
      y = maxY + 120;
      const avgX = nodes.reduce((sum, n) => sum + n.position.x, 0) / nodes.length;
      x = Math.round(avgX / 16) * 16;
    }

    const newNode: Node = {
      id: newNodeId,
      type: 'httpRequestNode',
      position: { x, y },
      data: { label: 'HTTP Request', method: 'GET', url: '' },
    };

    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes]);

  /** Add a Delay node from the toolbar button */
  const addDelayNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;

    let y = 200;
    let x = 400;
    if (nodes.length > 0) {
      const maxY = Math.max(...nodes.map((n) => n.position.y));
      y = maxY + 120;
      const avgX = nodes.reduce((sum, n) => sum + n.position.x, 0) / nodes.length;
      x = Math.round(avgX / 16) * 16;
    }

    const newNode: Node = {
      id: newNodeId,
      type: 'delayNode',
      position: { x, y },
      data: { label: 'Delay', duration: '5', unit: 'seconds' },
    };

    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes]);

  /** Add a Notification node */
  const addNotificationNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;
    let y = 200, x = 400;
    if (nodes.length > 0) {
      const maxY = Math.max(...nodes.map((n) => n.position.y));
      y = maxY + 120;
      x = Math.round(nodes.reduce((s, n) => s + n.position.x, 0) / nodes.length / 16) * 16;
    }
    setNodes((nds) => [...nds, { id: newNodeId, type: 'notificationNode', position: { x, y }, data: { label: 'Notification', message: '', severity: 'info' } }]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes]);

  /** Add a Parallel node */
  const addParallelNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;
    let y = 200, x = 400;
    if (nodes.length > 0) {
      const maxY = Math.max(...nodes.map((n) => n.position.y));
      y = maxY + 120;
      x = Math.round(nodes.reduce((s, n) => s + n.position.x, 0) / nodes.length / 16) * 16;
    }
    setNodes((nds) => [...nds, { id: newNodeId, type: 'parallelNode', position: { x, y }, data: { label: 'Parallel', branchCount: 2, branchLabels: ['Branch 0', 'Branch 1'] } }]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes]);

  /** Add a Merge node */
  const addMergeNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;
    let y = 200, x = 400;
    if (nodes.length > 0) {
      const maxY = Math.max(...nodes.map((n) => n.position.y));
      y = maxY + 120;
      x = Math.round(nodes.reduce((s, n) => s + n.position.x, 0) / nodes.length / 16) * 16;
    }
    setNodes((nds) => [...nds, { id: newNodeId, type: 'mergeNode', position: { x, y }, data: { label: 'Merge', mode: 'waitAll' } }]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes]);

  /** Add a Sticky Note node from the toolbar button */
  const addStickyNoteNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;

    let y = 200;
    let x = 400;
    if (nodes.length > 0) {
      const maxY = Math.max(...nodes.map((n) => n.position.y));
      y = maxY + 120;
      const avgX = nodes.reduce((sum, n) => sum + n.position.x, 0) / nodes.length;
      x = Math.round(avgX / 16) * 16;
    }

    const newNode: Node = {
      id: newNodeId,
      type: 'stickyNoteNode',
      position: { x, y },
      data: { label: 'Note', text: '', color: 'yellow' },
    };

    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes]);

  /** Add a Switch node from the toolbar button */
  const addSwitchNode = useCallback(() => {
    nodeIdCounter.current += 1;
    const newNodeId = `node_${nodeIdCounter.current}`;

    let y = 200;
    let x = 400;
    if (nodes.length > 0) {
      const maxY = Math.max(...nodes.map((n) => n.position.y));
      y = maxY + 120;
      const avgX = nodes.reduce((sum, n) => sum + n.position.x, 0) / nodes.length;
      x = Math.round(avgX / 16) * 16;
    }

    const newNode: Node = {
      id: newNodeId,
      type: 'switchNode',
      position: { x, y },
      data: {
        label: 'Switch',
        expression: '',
        cases: [{ label: 'case_1', value: '' }],
      },
    };

    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newNodeId);
    setHasUnsavedChanges(true);
  }, [nodes, setNodes]);

  const syncTrigger = useCallback(
    async (workflowId: string, wfName: string, td: TriggerNodeData, nodeId: string) => {
      const config: Record<string, unknown> = {};
      if (td.triggerType === 'schedule') {
        config.cron = td.cron ?? '0 8 * * *';
        if (td.timezone) config.timezone = td.timezone;
      } else if (td.triggerType === 'event') {
        config.eventType = td.eventType ?? '';
      } else if (td.triggerType === 'condition') {
        config.condition = td.condition ?? '';
        if (td.threshold) config.threshold = td.threshold;
        if (td.checkInterval) config.checkInterval = td.checkInterval;
      } else if (td.triggerType === 'webhook') {
        if (td.webhookPath) config.webhookPath = td.webhookPath;
      }

      const body = {
        name: `Workflow: ${wfName}`,
        type: td.triggerType,
        config,
        action: { type: 'workflow' as const, payload: { workflowId } },
        enabled: true,
      };

      try {
        if (td.triggerId) {
          await triggersApi.update(td.triggerId, body);
        } else {
          const created = await apiClient.post<{ id: string }>('/triggers', body);
          updateNodeData(nodeId, { triggerId: created.id });
        }
      } catch {
        // Non-critical — trigger sync failure shouldn't block save
      }
    },
    [updateNodeData]
  );

  // ========================================================================
  // Derived state
  // ========================================================================

  const handleAddNode = useCallback(
    (nodeType: string) => {
      switch (nodeType) {
        case 'triggerNode':
          addTriggerNode();
          break;
        case 'llmNode':
          addLlmNode();
          break;
        case 'conditionNode':
          addConditionNode();
          break;
        case 'codeNode':
          addCodeNode();
          break;
        case 'transformerNode':
          addTransformerNode();
          break;
        case 'forEachNode':
          addForEachNode();
          break;
        case 'httpRequestNode':
          addHttpRequestNode();
          break;
        case 'delayNode':
          addDelayNode();
          break;
        case 'switchNode':
          addSwitchNode();
          break;
        case 'stickyNoteNode':
          addStickyNoteNode();
          break;
        case 'notificationNode':
          addNotificationNode();
          break;
        case 'parallelNode':
          addParallelNode();
          break;
        case 'mergeNode':
          addMergeNode();
          break;
      }
    },
    [addTriggerNode, addLlmNode, addConditionNode, addCodeNode, addTransformerNode, addForEachNode, addHttpRequestNode, addDelayNode, addSwitchNode, addStickyNoteNode, addNotificationNode, addParallelNode, addMergeNode]
  );

  const handleApplyWorkflow = useCallback(
    (definition: WorkflowDefinition) => {
      if (nodes.length > 0 && !confirm('This will replace all current nodes and edges. Continue?'))
        return;

      const { nodes: rfNodes, edges: rfEdges } = convertDefinitionToReactFlow(
        definition,
        toolNames
      );

      // Apply edge label styling
      const styledEdges = rfEdges.map((e) => ({
        ...e,
        ...getEdgeLabelProps(e.sourceHandle),
      }));

      // Update node ID counter to max
      const maxId = rfNodes.reduce((max, n) => {
        const num = parseInt(n.id.replace('node_', ''), 10);
        return isNaN(num) ? max : Math.max(max, num);
      }, 0);
      nodeIdCounter.current = maxId;

      setNodes(rfNodes);
      setEdges(styledEdges);
      if (definition.name) setWorkflowName(definition.name);
      setHasUnsavedChanges(true);
      setSelectedNodeId(null);
      toast.success('Workflow applied from Copilot');
    },
    [nodes, toolNames, setNodes, setEdges, toast]
  );

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  const upstreamNodes = useMemo(() => {
    if (!selectedNodeId) return [];
    const sourceIds = new Set(
      edges.filter((e) => e.target === selectedNodeId).map((e) => e.source)
    );
    return nodes.filter((n) => sourceIds.has(n.id)) as ToolNodeType[];
  }, [selectedNodeId, edges, nodes]);

  // ========================================================================
  // Render
  // ========================================================================

  if (isLoading) {
    return <LoadingSpinner message="Loading workflow..." />;
  }

  if (!workflow) {
    return null;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top Bar */}
      <header className="flex items-center gap-3 px-4 py-2.5 border-b border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
        <button
          onClick={() => navigate('/workflows')}
          className="p-1.5 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
          title="Back to Workflows"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <input
          type="text"
          value={workflowName}
          onChange={(e) => {
            setWorkflowName(e.target.value);
            setHasUnsavedChanges(true);
          }}
          className="flex-1 text-sm font-semibold bg-transparent text-text-primary dark:text-dark-text-primary border-none focus:outline-none focus:ring-0 min-w-0"
          placeholder="Workflow name..."
        />

        {hasUnsavedChanges && <span className="text-xs text-warning">Unsaved</span>}

        <button
          onClick={handleSave}
          disabled={isSaving || !hasUnsavedChanges}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md transition-colors disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" />
          {isSaving ? 'Saving...' : 'Save'}
        </button>

        <button
          onClick={handleArrange}
          disabled={nodes.length === 0 || isExecuting}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md transition-colors disabled:opacity-50"
          title="Auto-arrange nodes"
        >
          <LayoutDashboard className="w-3.5 h-3.5" />
          Arrange
        </button>

        <button
          onClick={() => setShowSource(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md transition-colors"
          title="View workflow source"
        >
          <Code className="w-3.5 h-3.5" />
          Source
        </button>

        <button
          onClick={() => {
            setShowVariables(!showVariables);
            if (!showVariables) {
              setShowCopilot(false);
              setShowVersions(false);
              setSelectedNodeId(null);
            }
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            showVariables
              ? 'bg-primary text-white'
              : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-border dark:border-dark-border'
          }`}
          title={showVariables ? 'Hide Variables' : 'Edit workflow variables'}
        >
          <ListChecks className="w-3.5 h-3.5" />
          Variables
          {Object.keys(variables).length > 0 && (
            <span className="ml-0.5 px-1.5 py-0 text-[10px] bg-white/20 rounded-full">
              {Object.keys(variables).length}
            </span>
          )}
        </button>

        <button
          onClick={() => {
            setShowInputParams(!showInputParams);
            if (!showInputParams) {
              setShowCopilot(false);
              setShowVariables(false);
              setShowVersions(false);
              setSelectedNodeId(null);
            }
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            showInputParams
              ? 'bg-primary text-white'
              : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-border dark:border-dark-border'
          }`}
          title={showInputParams ? 'Hide Input Parameters' : 'Define workflow input parameters'}
        >
          <Settings className="w-3.5 h-3.5" />
          Inputs
          {inputSchema.length > 0 && (
            <span className="ml-0.5 px-1.5 py-0 text-[10px] bg-white/20 rounded-full">
              {inputSchema.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setShowTemplates(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md transition-colors"
          title="Import from template gallery"
        >
          <Layout className="w-3.5 h-3.5" />
          Templates
        </button>

        <button
          onClick={() => {
            setShowVersions(!showVersions);
            if (!showVersions) {
              setShowCopilot(false);
              setShowVariables(false);
              setSelectedNodeId(null);
            }
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            showVersions
              ? 'bg-primary text-white'
              : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-border dark:border-dark-border'
          }`}
          title={showVersions ? 'Hide Versions' : 'Version history'}
        >
          <History className="w-3.5 h-3.5" />
          Versions
        </button>

        <button
          onClick={() => {
            setShowCopilot(!showCopilot);
            if (!showCopilot) {
              setShowVariables(false);
              setShowVersions(false);
              setSelectedNodeId(null);
            }
          }}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            showCopilot
              ? 'bg-primary text-white'
              : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-border dark:border-dark-border'
          }`}
          title={
            showCopilot ? 'Hide Copilot' : 'AI Copilot — build workflows with natural language'
          }
        >
          <Sparkles className="w-3.5 h-3.5" />
          Copilot
        </button>

        {isExecuting ? (
          <button
            onClick={handleCancel}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 rounded-md transition-colors ${isDryRun ? 'bg-warning' : 'bg-error'}`}
          >
            <StopCircle className="w-3.5 h-3.5" />
            {isDryRun ? 'Cancel Test' : 'Cancel'}
          </button>
        ) : (
          <>
            <button
              onClick={() => handleExecute(true)}
              disabled={nodes.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-warning/15 text-warning hover:bg-warning/25 border border-warning/30 rounded-md transition-colors disabled:opacity-50"
              title="Dry-run: resolve templates without executing side-effect nodes (LLM, HTTP, Delay, Tool)"
            >
              <FlaskConical className="w-3.5 h-3.5" />
              Test Run
            </button>
            <button
              onClick={() => handleExecute(false)}
              disabled={nodes.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-white hover:bg-primary-dark rounded-md transition-colors disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              Execute
            </button>
          </>
        )}
      </header>

      {/* Three-panel layout */}
      <div className="flex-1 flex overflow-hidden">
        <ToolPalette
          className="w-60 shrink-0"
          onAddTool={addToolNode}
          onAddNode={handleAddNode}
          hasTriggerNode={hasTriggerNode}
        />

        <div className="flex-1 relative" onDragOver={onDragOver} onDrop={onDrop}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChangeWrapped}
            onEdgesChange={onEdgesChangeWrapped}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            fitView
            snapToGrid
            snapGrid={[16, 16]}
            nodesDraggable={!isExecuting}
            nodesConnectable={!isExecuting}
            elementsSelectable={!isExecuting}
            deleteKeyCode={isExecuting ? null : 'Delete'}
            className="bg-bg-primary dark:bg-dark-bg-primary"
          >
            <Background gap={16} size={1} />
            <Controls
              showInteractive={false}
              className="!bg-bg-secondary dark:!bg-dark-bg-secondary !border-border dark:!border-dark-border !shadow-sm"
            />
            <MiniMap
              nodeStrokeWidth={3}
              className="!bg-bg-secondary dark:!bg-dark-bg-secondary !border-border dark:!border-dark-border"
            />
          </ReactFlow>

          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <p className="text-text-muted dark:text-dark-text-muted text-sm">
                Drag tools from the left panel to start building your workflow
              </p>
            </div>
          )}
        </div>

        {selectedNode ? (
          <NodeConfigPanel
            node={selectedNode}
            upstreamNodes={upstreamNodes}
            onUpdate={updateNodeData}
            onDelete={deleteNode}
            onClose={() => setSelectedNodeId(null)}
            className="w-80 shrink-0"
          />
        ) : showVariables ? (
          <VariablesPanel
            variables={variables}
            onChange={handleVariablesChange}
            onClose={() => setShowVariables(false)}
            className="w-80 shrink-0"
          />
        ) : showInputParams ? (
          <InputParametersPanel
            parameters={inputSchema}
            onChange={(params) => {
              setInputSchema(params);
              setHasUnsavedChanges(true);
            }}
            onClose={() => setShowInputParams(false)}
          />
        ) : showVersions && id ? (
          <WorkflowVersionsPanel
            workflowId={id}
            onRestore={(data) => {
              setNodes(data.nodes as Node[]);
              setEdges(data.edges as Edge[]);
              setVariables(data.variables);
              setHasUnsavedChanges(false);
              toast.success('Version restored');
            }}
            onClose={() => setShowVersions(false)}
            className="w-80 shrink-0"
          />
        ) : showCopilot ? (
          <WorkflowCopilotPanel
            workflowName={workflowName}
            nodes={nodes}
            edges={edges}
            availableToolNames={toolNames}
            onApplyWorkflow={handleApplyWorkflow}
            onClose={() => setShowCopilot(false)}
          />
        ) : null}
      </div>

      {showNodeSearch && (
        <NodeSearchPalette
          toolNames={toolNames}
          onAddNode={handleAddNode}
          onAddTool={addToolNode}
          onClose={() => setShowNodeSearch(false)}
          hasTriggerNode={hasTriggerNode}
        />
      )}

      {showTemplates && (
        <TemplateGallery
          onUseTemplate={(template) => {
            const { nodes: rfNodes, edges: rfEdges } = convertDefinitionToReactFlow(
              template.definition as WorkflowDefinition,
              toolNames
            );
            const styledEdges = rfEdges.map((e) => ({
              ...e,
              ...getEdgeLabelProps(e.sourceHandle),
            }));
            const maxId = rfNodes.reduce((max, n) => {
              const num = parseInt(n.id.replace('node_', ''), 10);
              return isNaN(num) ? max : Math.max(max, num);
            }, 0);
            nodeIdCounter.current = maxId;
            setNodes(rfNodes);
            setEdges(styledEdges);
            if (template.definition.name) setWorkflowName(template.definition.name);
            setHasUnsavedChanges(true);
            setShowTemplates(false);
            toast.success(`Template "${template.name}" applied`);
          }}
          onClose={() => setShowTemplates(false)}
        />
      )}

      {showSource && (
        <WorkflowSourceModal
          workflowName={workflowName}
          nodes={nodes}
          edges={edges}
          variables={variables}
          onClose={() => setShowSource(false)}
          onImport={handleImportWorkflow}
        />
      )}
    </div>
  );
}

/** Edge label + color config for named source handles */
const HANDLE_EDGE_PROPS: Record<string, { label: string; style: Record<string, string> }> = {
  true: { label: 'True', style: { stroke: '#10b981' } }, // emerald
  false: { label: 'False', style: { stroke: '#ef4444' } }, // red
  each: { label: 'Each', style: { stroke: '#0ea5e9' } }, // sky
  done: { label: 'Done', style: { stroke: '#8b5cf6' } }, // violet
};

const EDGE_LABEL_STYLE = {
  fontSize: 10,
  fontWeight: 600,
  fill: 'var(--color-text-muted)',
} as const;

function getEdgeLabelProps(sourceHandle: string | null | undefined) {
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

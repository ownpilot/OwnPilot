/**
 * useWorkflowEditor — main composition hook that imports and orchestrates
 * the focused sub-hooks: history, canvas, nodes, execution, and keyboard.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useNodesState, useEdgesState, type Edge, type Node } from '@xyflow/react';

import { workflowsApi, toolsApi } from '../../api';
import type { Workflow } from '../../api';
import {
  convertDefinitionToReactFlow,
  type ToolNodeType,
  type WorkflowDefinition,
} from '../../components/workflows';
import { useToast } from '../../components/ToastProvider';
import { useDialog } from '../../components/ConfirmDialog';
import { getEdgeLabelProps } from './shared';

import { useWorkflowHistory } from './useWorkflowHistory';
import { useWorkflowCanvas } from './useWorkflowCanvas';
import { useWorkflowNodes } from './useWorkflowNodes';
import { useWorkflowExecution } from './useWorkflowExecution';
import { useWorkflowKeyboard } from './useWorkflowKeyboard';

export function useWorkflowEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const { confirm } = useDialog();

  // ========================================================================
  // Shared state
  // ========================================================================

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
  const [inputSchema, setInputSchema] = useState<
    Array<{
      name: string;
      type: 'string' | 'number' | 'boolean' | 'json';
      required: boolean;
      defaultValue?: string;
      description?: string;
    }>
  >([]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const abortRef = useRef<AbortController | null>(null);
  const nodeIdCounter = useRef(0);
  const clipboardRef = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);

  // ========================================================================
  // Sub-hooks
  // ========================================================================

  const { historyRef, historyIndexRef, pushHistory, undo, redo } = useWorkflowHistory({
    nodes,
    edges,
    variables,
    setNodes,
    setEdges,
    setVariables,
    setHasUnsavedChanges,
  });

  const {
    isValidConnection,
    onConnect,
    onNodesChangeWrapped,
    onEdgesChangeWrapped,
    onNodeClick,
    onPaneClick,
    handleArrange,
    onDragOver,
    onDrop,
    updateNodeData,
    deleteNode,
  } = useWorkflowCanvas({
    nodes,
    edges,
    setNodes,
    setEdges,
    onNodesChange,
    onEdgesChange,
    setSelectedNodeId,
    setHasUnsavedChanges,
    nodeIdCounter,
    pushHistory,
  });

  const { hasTriggerNode, addToolNode, syncTrigger, handleAddNode } = useWorkflowNodes({
    nodes,
    setNodes,
    setSelectedNodeId,
    setHasUnsavedChanges,
    nodeIdCounter,
    updateNodeData,
    toast,
  });

  const { handleSave, handleExecute, handleCancel } = useWorkflowExecution({
    id,
    workflow,
    nodes,
    edges,
    workflowName,
    variables,
    inputSchema,
    isExecuting,
    hasUnsavedChanges,
    setNodes,
    setEdges,
    setIsSaving,
    setIsExecuting,
    setIsDryRun,
    setHasUnsavedChanges,
    abortRef,
    updateNodeData,
    syncTrigger,
    toast,
  });

  useWorkflowKeyboard({
    nodes,
    edges,
    setNodes,
    setEdges,
    selectedNodeId,
    setSelectedNodeId,
    hasUnsavedChanges,
    isSaving,
    showCopilot,
    setShowCopilot,
    showVariables,
    setShowVariables,
    showVersions,
    setShowVersions,
    showNodeSearch,
    setShowNodeSearch,
    setHasUnsavedChanges,
    nodeIdCounter,
    clipboardRef,
    handleSave,
    deleteNode,
    undo,
    redo,
    pushHistory,
  });

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
            n.type === 'mergeNode' ||
            n.type === 'dataStoreNode' ||
            n.type === 'schemaValidatorNode' ||
            n.type === 'filterNode' ||
            n.type === 'mapNode' ||
            n.type === 'aggregateNode' ||
            n.type === 'webhookResponseNode'
          ) {
            return {
              id: n.id,
              type: n.type,
              position: n.position,
              data: n.data as unknown as Record<string, unknown>,
            };
          }
          const td = n.data as import('../../api/types').WorkflowToolNodeData;
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
        historyRef.current = [
          {
            nodes: rfNodes.map((n) => ({ ...n, data: { ...n.data } })),
            edges: rfEdges.map((e) => ({ ...e })),
            variables: wf.variables ?? {},
          },
        ];
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
    async (json: Record<string, unknown>) => {
      if (
        nodes.length > 0 &&
        !(await confirm({ message: 'This will replace all current nodes and edges. Continue?' }))
      )
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
  // Apply workflow from Copilot
  // ========================================================================

  const handleApplyWorkflow = useCallback(
    async (definition: WorkflowDefinition) => {
      if (
        nodes.length > 0 &&
        !(await confirm({ message: 'This will replace all current nodes and edges. Continue?' }))
      )
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

  // ========================================================================
  // Derived state
  // ========================================================================

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

  return {
    // Route params
    id,
    navigate,

    // Loading/saving/executing state
    isLoading,
    isSaving,
    isExecuting,
    isDryRun,
    workflow,

    // Workflow metadata
    workflowName,
    setWorkflowName,
    variables,
    setVariables,
    inputSchema,
    setInputSchema,
    toolNames,

    // Unsaved changes
    hasUnsavedChanges,
    setHasUnsavedChanges,

    // Panel visibility
    showSource,
    setShowSource,
    showCopilot,
    setShowCopilot,
    showVariables,
    setShowVariables,
    showVersions,
    setShowVersions,
    showNodeSearch,
    setShowNodeSearch,
    showInputParams,
    setShowInputParams,
    showTemplates,
    setShowTemplates,

    // ReactFlow state
    nodes,
    edges,
    setNodes,
    setEdges,
    selectedNodeId,
    setSelectedNodeId,
    selectedNode,
    upstreamNodes,
    nodeIdCounter,

    // Canvas handlers
    onNodesChangeWrapped,
    onEdgesChangeWrapped,
    onConnect,
    isValidConnection,
    onNodeClick,
    onPaneClick,
    onDragOver,
    onDrop,

    // Actions
    handleSave,
    handleExecute,
    handleCancel,
    handleArrange,
    handleVariablesChange,
    handleImportWorkflow,
    handleAddNode,
    handleApplyWorkflow,
    updateNodeData,
    deleteNode,
    addToolNode,
    hasTriggerNode,

    // Toast (needed by render for inline callbacks)
    toast,
  };
}

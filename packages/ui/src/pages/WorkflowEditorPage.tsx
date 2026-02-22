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
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { workflowsApi, triggersApi, apiClient } from '../api';
import type { Workflow, WorkflowProgressEvent } from '../api';
import { formatToolName } from '../utils/formatters';
import {
  ToolNode, ToolPalette, NodeConfigPanel, WorkflowSourceModal,
  TriggerNode, LlmNode, ConditionNode, CodeNode, TransformerNode, ForEachNode,
  WorkflowCopilotPanel, convertDefinitionToReactFlow,
  type ToolNodeData, type ToolNodeType, type TriggerNodeData, type LlmNodeData,
  type ConditionNodeData, type CodeNodeData, type TransformerNodeData, type ForEachNodeData,
  type WorkflowDefinition,
} from '../components/workflows';
import { ChevronLeft, Save, Play, StopCircle, Code, Sparkles } from '../components/icons';
import { toolsApi } from '../api';
import { useToast } from '../components/ToastProvider';
import { LoadingSpinner } from '../components/LoadingSpinner';

// Register custom node types
const nodeTypes = {
  toolNode: ToolNode, triggerNode: TriggerNode, llmNode: LlmNode,
  conditionNode: ConditionNode, codeNode: CodeNode, transformerNode: TransformerNode,
  forEachNode: ForEachNode,
};

// Default edge options — arrow markers for flow direction
const defaultEdgeOptions = {
  style: { stroke: 'var(--color-border)', strokeWidth: 2 },
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: 'var(--color-border)' },
};

// ============================================================================
// Main Component
// ============================================================================

export function WorkflowEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const toast = useToast();

  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [workflowName, setWorkflowName] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [showCopilot, setShowCopilot] = useState(false);
  const [toolNames, setToolNames] = useState<string[]>([]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const abortRef = useRef<AbortController | null>(null);
  const nodeIdCounter = useRef(0);

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

        // Convert stored nodes to ReactFlow nodes
        const rfNodes: Node[] = wf.nodes.map((n) => {
          if (n.type === 'triggerNode' || n.type === 'llmNode'
            || n.type === 'conditionNode' || n.type === 'codeNode' || n.type === 'transformerNode'
            || n.type === 'forEachNode') {
            return { id: n.id, type: n.type, position: n.position, data: n.data as unknown as Record<string, unknown> };
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
      } catch {
        toast.error('Failed to load workflow');
        navigate('/workflows');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Fetch available tool names for the copilot (only workflow-usable tools)
  useEffect(() => {
    toolsApi.list().then((tools) =>
      setToolNames(tools.filter((t) => t.workflowUsable !== false).map((t) => t.name))
    ).catch(() => {});
  }, []);

  // Auto-execute if ?execute=true
  useEffect(() => {
    if (!isLoading && workflow && searchParams.get('execute') === 'true') {
      handleExecute();
    }
  }, [isLoading, workflow]);

  // ========================================================================
  // Canvas handlers
  // ========================================================================

  const onConnect = useCallback(
    (connection: Connection) => {
      const edgeProps = getEdgeLabelProps(connection.sourceHandle);
      setEdges((eds) => addEdge({ ...connection, ...edgeProps }, eds));
      setHasUnsavedChanges(true);
    },
    [setEdges],
  );

  const onNodesChangeWrapped = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes);
      if (changes.some((c) => c.type === 'position' || c.type === 'remove' || c.type === 'add')) {
        setHasUnsavedChanges(true);
      }
    },
    [onNodesChange],
  );

  const onEdgesChangeWrapped = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      onEdgesChange(changes);
      if (changes.some((c) => c.type === 'remove' || c.type === 'add')) {
        setHasUnsavedChanges(true);
      }
    },
    [onEdgesChange],
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

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

      const reactFlowBounds = (e.target as HTMLElement).closest('.react-flow')?.getBoundingClientRect();
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
    [setNodes],
  );

  // ========================================================================
  // Node CRUD
  // ========================================================================

  const updateNodeData = useCallback(
    (nodeId: string, data: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n)),
      );
      setHasUnsavedChanges(true);
    },
    [setNodes],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedNodeId(null);
      setHasUnsavedChanges(true);
    },
    [setNodes, setEdges],
  );

  // ========================================================================
  // Save
  // ========================================================================

  const handleSave = useCallback(async () => {
    if (!id || !workflow) return;
    setIsSaving(true);
    try {
      const wfNodes = nodes.map((n) => {
        if (n.type === 'triggerNode') {
          const td = n.data as unknown as TriggerNodeData;
          return {
            id: n.id, type: 'triggerNode', position: n.position,
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
            },
          };
        }
        if (n.type === 'conditionNode') {
          const cd = n.data as unknown as ConditionNodeData;
          return {
            id: n.id, type: 'conditionNode', position: n.position,
            data: {
              label: cd.label, expression: cd.expression, description: cd.description,
              ...(cd.retryCount != null ? { retryCount: cd.retryCount } : {}),
              ...(cd.timeoutMs != null ? { timeoutMs: cd.timeoutMs } : {}),
            },
          };
        }
        if (n.type === 'codeNode') {
          const cd = n.data as unknown as CodeNodeData;
          return {
            id: n.id, type: 'codeNode', position: n.position,
            data: {
              label: cd.label, language: cd.language, code: cd.code, description: cd.description,
              ...(cd.retryCount != null ? { retryCount: cd.retryCount } : {}),
              ...(cd.timeoutMs != null ? { timeoutMs: cd.timeoutMs } : {}),
            },
          };
        }
        if (n.type === 'transformerNode') {
          const td = n.data as unknown as TransformerNodeData;
          return {
            id: n.id, type: 'transformerNode', position: n.position,
            data: {
              label: td.label, expression: td.expression, description: td.description,
              ...(td.retryCount != null ? { retryCount: td.retryCount } : {}),
              ...(td.timeoutMs != null ? { timeoutMs: td.timeoutMs } : {}),
            },
          };
        }
        if (n.type === 'forEachNode') {
          const fd = n.data as unknown as ForEachNodeData;
          return {
            id: n.id, type: 'forEachNode', position: n.position,
            data: {
              label: fd.label,
              arrayExpression: fd.arrayExpression,
              ...(fd.itemVariable ? { itemVariable: fd.itemVariable } : {}),
              ...(fd.maxIterations != null ? { maxIterations: fd.maxIterations } : {}),
              ...(fd.onError ? { onError: fd.onError } : {}),
              ...(fd.description ? { description: fd.description } : {}),
              ...(fd.retryCount != null ? { retryCount: fd.retryCount } : {}),
              ...(fd.timeoutMs != null ? { timeoutMs: fd.timeoutMs } : {}),
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
      });

      // Sync trigger node with trigger system
      const triggerNode = nodes.find((n) => n.type === 'triggerNode');
      if (triggerNode) {
        const td = triggerNode.data as unknown as TriggerNodeData;
        if (td.triggerType !== 'manual') {
          await syncTrigger(id, workflowName, td, triggerNode.id);
        } else if (td.triggerId) {
          // Manual mode — delete linked trigger
          try { await triggersApi.delete(td.triggerId); } catch { /* may not exist */ }
          updateNodeData(triggerNode.id, { triggerId: undefined });
        }
      } else {
        // Trigger node removed — clean up linked trigger if it existed
        const oldTrigger = workflow.nodes.find((n) => n.type === 'triggerNode');
        const oldTriggerId = (oldTrigger?.data as unknown as Record<string, unknown>)?.triggerId as string | undefined;
        if (oldTriggerId) {
          try { await triggersApi.delete(oldTriggerId); } catch { /* ignore */ }
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

  const handleExecute = useCallback(async () => {
    if (!id || isExecuting) return;

    if (hasUnsavedChanges) {
      await handleSave();
    }

    setIsExecuting(true);

    // Reset all node statuses
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: { ...n.data, executionStatus: 'pending', executionError: undefined, executionDuration: undefined, executionOutput: undefined, resolvedArgs: undefined, branchTaken: undefined, currentIteration: undefined, totalIterations: undefined },
      })),
    );

    // Animate edges during execution
    setEdges((eds) => eds.map((e) => ({ ...e, animated: true })));

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const response = await workflowsApi.execute(id);
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
              n.id === event.nodeId
                ? { ...n, data: { ...n.data, executionStatus: 'running' } }
                : n,
            ),
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
                : n,
            ),
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
                : n,
            ),
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
                : n,
            ),
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
                : n,
            ),
          );
          break;

        case 'done':
          toast.success(
            event.logStatus === 'completed'
              ? `Workflow completed in ${event.durationMs ? `${(event.durationMs / 1000).toFixed(1)}s` : 'N/A'}`
              : `Workflow ${event.logStatus ?? 'finished'}`,
          );
          break;

        case 'error':
          toast.error(event.error ?? 'Execution error');
          break;
      }
    },
    [setNodes, toast],
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
  const addToolNode = useCallback((toolName: string, toolDescription?: string) => {
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
  }, [nodes, setNodes]);

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

  const syncTrigger = useCallback(async (workflowId: string, wfName: string, td: TriggerNodeData, nodeId: string) => {
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
  }, [updateNodeData]);

  // ========================================================================
  // Derived state
  // ========================================================================

  const handleAddNode = useCallback((nodeType: string) => {
    switch (nodeType) {
      case 'triggerNode': addTriggerNode(); break;
      case 'llmNode': addLlmNode(); break;
      case 'conditionNode': addConditionNode(); break;
      case 'codeNode': addCodeNode(); break;
      case 'transformerNode': addTransformerNode(); break;
      case 'forEachNode': addForEachNode(); break;
    }
  }, [addTriggerNode, addLlmNode, addConditionNode, addCodeNode, addTransformerNode, addForEachNode]);

  const handleApplyWorkflow = useCallback((definition: WorkflowDefinition) => {
    if (nodes.length > 0 && !confirm('This will replace all current nodes and edges. Continue?')) return;

    const { nodes: rfNodes, edges: rfEdges } = convertDefinitionToReactFlow(definition, toolNames);

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
  }, [nodes, toolNames, setNodes, setEdges, toast]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  const upstreamNodes = useMemo(() => {
    if (!selectedNodeId) return [];
    const sourceIds = new Set(
      edges.filter((e) => e.target === selectedNodeId).map((e) => e.source),
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

        {hasUnsavedChanges && (
          <span className="text-xs text-warning">Unsaved</span>
        )}

        <button
          onClick={handleSave}
          disabled={isSaving || !hasUnsavedChanges}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md transition-colors disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" />
          {isSaving ? 'Saving...' : 'Save'}
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
          onClick={() => setShowCopilot(!showCopilot)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
            showCopilot
              ? 'bg-primary text-white'
              : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-border dark:border-dark-border'
          }`}
          title={showCopilot ? 'Hide Copilot' : 'AI Copilot — build workflows with natural language'}
        >
          <Sparkles className="w-3.5 h-3.5" />
          Copilot
        </button>

        {isExecuting ? (
          <button
            onClick={handleCancel}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-error text-white hover:bg-error/90 rounded-md transition-colors"
          >
            <StopCircle className="w-3.5 h-3.5" />
            Cancel
          </button>
        ) : (
          <button
            onClick={handleExecute}
            disabled={nodes.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-white hover:bg-primary-dark rounded-md transition-colors disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            Execute
          </button>
        )}
      </header>

      {/* Three-panel layout */}
      <div className="flex-1 flex overflow-hidden">
        <ToolPalette className="w-60 shrink-0" onAddTool={addToolNode} onAddNode={handleAddNode} hasTriggerNode={hasTriggerNode} />

        <div className="flex-1 relative" onDragOver={onDragOver} onDrop={onDrop}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChangeWrapped}
            onEdgesChange={onEdgesChangeWrapped}
            onConnect={onConnect}
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

      {showSource && (
        <WorkflowSourceModal
          workflowName={workflowName}
          nodes={nodes}
          edges={edges}
          variables={workflow.variables}
          onClose={() => setShowSource(false)}
        />
      )}
    </div>
  );
}


/** Edge label + color config for named source handles */
const HANDLE_EDGE_PROPS: Record<string, { label: string; style: Record<string, string> }> = {
  true:  { label: 'True',  style: { stroke: '#10b981' } },   // emerald
  false: { label: 'False', style: { stroke: '#ef4444' } },   // red
  each:  { label: 'Each',  style: { stroke: '#0ea5e9' } },   // sky
  done:  { label: 'Done',  style: { stroke: '#8b5cf6' } },   // violet
};

const EDGE_LABEL_STYLE = {
  fontSize: 10,
  fontWeight: 600,
  fill: 'var(--color-text-muted)',
} as const;

function getEdgeLabelProps(sourceHandle: string | null | undefined) {
  if (!sourceHandle) return {};
  const cfg = HANDLE_EDGE_PROPS[sourceHandle];
  if (!cfg) return {};
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

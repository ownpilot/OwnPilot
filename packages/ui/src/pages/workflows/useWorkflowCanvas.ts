/**
 * useWorkflowCanvas — canvas interaction handlers for the workflow editor.
 * Covers connection validation, node/edge change wrapping, drag-and-drop,
 * node click/select, auto-arrange, and node CRUD (updateNodeData, deleteNode).
 */

import { useCallback } from 'react';
import {
  addEdge,
  useReactFlow,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';

import { formatToolName } from '../../utils/formatters';
import { autoArrangeNodes } from '../../components/workflows';
import { getEdgeLabelProps } from './shared';

export interface WorkflowCanvasParams {
  nodes: Node[];
  edges: Edge[];
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  onNodesChange: (changes: NodeChange<Node>[]) => void;
  onEdgesChange: (changes: EdgeChange<Edge>[]) => void;
  setSelectedNodeId: (id: string | null) => void;
  setHasUnsavedChanges: (v: boolean) => void;
  nodeIdCounter: React.MutableRefObject<number>;
  pushHistory: () => void;
}

export function useWorkflowCanvas(params: WorkflowCanvasParams) {
  const {
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
  } = params;

  const reactFlow = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();

  // Connection validation -- prevent invalid edges
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
      if (sourceNode?.type === 'stickyNoteNode' || targetNode?.type === 'stickyNoteNode')
        return false;
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
    [setEdges, pushHistory, setHasUnsavedChanges]
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
    [onNodesChange, pushHistory, setHasUnsavedChanges]
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
    [onEdgesChange, pushHistory, setHasUnsavedChanges]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, [setSelectedNodeId]);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, [setSelectedNodeId]);

  const handleArrange = useCallback(() => {
    const arranged = autoArrangeNodes(nodes, edges);
    setNodes(arranged);
    setHasUnsavedChanges(true);
    requestAnimationFrame(() => {
      reactFlow.fitView({ padding: 0.15, duration: 300 });
    });
  }, [nodes, edges, setNodes, reactFlow, setHasUnsavedChanges]);

  // Drop handler -- create new node from palette drag
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
    [setNodes, nodeIdCounter, setSelectedNodeId, setHasUnsavedChanges]
  );

  // Node CRUD
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

          // Detect if handle count or labels changed -- triggers updateNodeInternals
          if (
            oldCases.length !== newCases.length ||
            oldCases.some((c, i) => c.label !== newCases[i]?.label)
          ) {
            needsHandleUpdate = true;
          }

          // Build old->new label mapping for renames
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
    [setNodes, setEdges, updateNodeInternals, pushHistory, setHasUnsavedChanges]
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      pushHistory();
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedNodeId(null);
      setHasUnsavedChanges(true);
    },
    [setNodes, setEdges, pushHistory, setSelectedNodeId, setHasUnsavedChanges]
  );

  return {
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
  };
}

/**
 * useWorkflowHistory — undo/redo history management for the workflow editor.
 */

import { useCallback, useRef } from 'react';
import type { Edge, Node } from '@xyflow/react';

const MAX_HISTORY = 50;

export interface WorkflowHistoryParams {
  nodes: Node[];
  edges: Edge[];
  variables: Record<string, unknown>;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  setVariables: (vars: Record<string, unknown>) => void;
  setHasUnsavedChanges: (v: boolean) => void;
}

export function useWorkflowHistory(params: WorkflowHistoryParams) {
  const { nodes, edges, variables, setNodes, setEdges, setVariables, setHasUnsavedChanges } =
    params;

  const historyRef = useRef<
    Array<{ nodes: Node[]; edges: Edge[]; variables: Record<string, unknown> }>
  >([]);
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
  }, [setNodes, setEdges, setVariables, setHasUnsavedChanges]);

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
  }, [setNodes, setEdges, setVariables, setHasUnsavedChanges]);

  return {
    historyRef,
    historyIndexRef,
    pushHistory,
    undo,
    redo,
  };
}
